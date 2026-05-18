import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  CallOutcome,
  CallQueueStatus,
  OrderStatus,
  QueueClosureReason,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  CallOutcomeMappingService,
  type RescheduleKind,
  type ResolvedOutcome,
} from './call-outcome-mapping.service';

const SETTING_MAX_ATTEMPTS = 'ops.call_max_attempts_before_ndr';
const SETTING_RESCHEDULE_MIN_HOURS = 'ops.call_reschedule_min_hours';
const SETTING_RESCHEDULE_MAX_DAYS = 'ops.call_reschedule_max_days';
const SETTING_BUSY_DELAY_HOURS = 'ops.call_busy_retry_delay_hours';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RESCHEDULE_MIN_HOURS = 1;
const DEFAULT_RESCHEDULE_MAX_DAYS = 7;
const DEFAULT_BUSY_DELAY_HOURS = 1;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface RecordAttemptInput {
  /** CallQueueEntry.id — must be ASSIGNED and owned by `agentId`. */
  assignmentId: string;
  /** Calling agent (StaffUser.id) — from the authenticated staff ctx. */
  agentId: string;
  outcome: CallOutcome;
  startedAt: Date;
  endedAt?: Date;
  outcomeNotes?: string;
  customerSaidName?: string;
  customerSaidAddress?: string;
  customerVerifiedItems?: boolean;
  /** REQUIRED iff outcome === CALLBACK_REQUESTED, FORBIDDEN otherwise.
   *  Bounds: [now + ops.call_reschedule_min_hours,
   *           now + ops.call_reschedule_max_days]. */
  scheduledFor?: Date;
  rescheduledReason?: string;
  flaggedAsSuspicious?: boolean;
  suspicionReason?: string;
  ctx?: ClientContext;
}

export interface RecordAttemptResult {
  attemptId: string;
  queueEntryId: string;
  outcome: CallOutcome;
  /** Order status the saga targeted (null = order status unchanged —
   *  TECHNICAL_FAILURE / LANGUAGE_BARRIER). */
  targetStatus: OrderStatus | null;
  /** Status the order actually landed on post-saga (e.g. OUT_OF_STOCK
   *  when a → CONFIRMED reserve failed); null when no transition ran or
   *  the transition failed (logged + audited HIGH, not thrown). */
  finalOrderStatus: OrderStatus | null;
  hitCap: boolean;
  requeued: boolean;
  requeuedAvailableAt: Date | null;
}

/**
 * Module 7 — CC-1/CC-3/CC-4/CC-5 attempt recorder. The heart of the
 * call-center workflow and the FIRST real consumer of the M5/M6 saga
 * pattern from outside the order domain.
 *
 * Ordering (deliberate):
 *  1. validate the assignment (exists / ASSIGNED / owned by caller)
 *  2. validate outcome ↔ scheduledFor invariants
 *  3. ATOMIC tx (CC-1 append-only attempt + CC-4 queue-entry close +
 *     in-tx audit). The attempt row is the SOURCE OF TRUTH (CC-3).
 *  4. POST-COMMIT saga: OrderWriteService.transitionStatus(). A failure
 *     here is logged + audited HIGH for ops and NEVER thrown upstream /
 *     NEVER rolls back the attempt — exactly the INV-5/M6 post-commit
 *     discipline. The M5 reserve saga may itself land CONFIRMED →
 *     OUT_OF_STOCK; that is M5's call and surfaces in `finalOrderStatus`.
 *  5. POST-COMMIT re-queue (enqueueAgain) when the outcome requeues and
 *     the NDR cap was not hit. A fresh OPEN entry is created (locked
 *     decision #2 — the just-closed COMPLETED row is the attempt
 *     history). Best-effort: a failure leaves the order without an open
 *     queue entry, reclaimable via admin re-enqueue (acceptable, mirrors
 *     the saga's post-commit-failure tolerance).
 */
@Injectable()
export class CallAttemptService {
  private readonly logger = new Logger(CallAttemptService.name);
  /** The 6/9 cap-counting outcomes (CC-5), derived once from the
   *  centralized mapping so it can never drift from CC-2. */
  private readonly countingOutcomes: CallOutcome[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orders: OrderReadService,
    private readonly orderWrites: OrderWriteService,
    private readonly queue: CallQueueService,
    private readonly mapping: CallOutcomeMappingService,
  ) {
    this.countingOutcomes = (Object.values(CallOutcome) as CallOutcome[]).filter(
      (o) => mapping.countsTowardCap(o),
    );
  }

  async recordAttempt(
    input: RecordAttemptInput,
  ): Promise<RecordAttemptResult> {
    const now = new Date();

    // 1. Assignment must exist, still be ASSIGNED, and be owned by the
    //    calling agent.
    const entry = await this.prisma.client.callQueueEntry.findUnique({
      where: { id: input.assignmentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        assignedAgentId: true,
      },
    });
    if (!entry) {
      throw new NotFoundException(
        `Assignment ${input.assignmentId} not found`,
      );
    }
    if (entry.status !== CallQueueStatus.ASSIGNED) {
      throw new ConflictException({
        code: 'ASSIGNMENT_NOT_ACTIVE',
        message: `Assignment is ${entry.status}, not ASSIGNED`,
      });
    }
    if (entry.assignedAgentId !== input.agentId) {
      throw new ForbiddenException({
        code: 'ASSIGNMENT_NOT_OWNED',
        message: 'Assignment is held by another agent',
      });
    }

    // 2. scheduledFor invariants (only CALLBACK_REQUESTED carries one).
    const isCallback = input.outcome === CallOutcome.CALLBACK_REQUESTED;
    if (!isCallback && input.scheduledFor !== undefined) {
      throw new BadRequestException({
        code: 'SCHEDULED_FOR_NOT_ALLOWED',
        message: 'scheduledFor is only valid for CALLBACK_REQUESTED',
      });
    }
    let agentScheduledFor: Date | null = null;
    if (isCallback) {
      if (input.scheduledFor === undefined) {
        throw new BadRequestException({
          code: 'SCHEDULED_FOR_REQUIRED',
          message: 'CALLBACK_REQUESTED requires scheduledFor',
        });
      }
      const { minHours, maxDays } = await this.rescheduleBounds();
      const lower = new Date(now.getTime() + minHours * MS_PER_HOUR);
      const upper = new Date(now.getTime() + maxDays * MS_PER_DAY);
      if (input.scheduledFor < lower || input.scheduledFor > upper) {
        throw new BadRequestException({
          code: 'SCHEDULED_FOR_OUT_OF_BOUNDS',
          message: `scheduledFor must be within ${minHours}h and ${maxDays}d from now`,
        });
      }
      agentScheduledFor = input.scheduledFor;
    }

    // Recipient phone from the IMMUTABLE order snapshot (ORD-6) — never
    // trust a client-supplied number for the attempt record.
    const order = await this.orders.getById(entry.orderId);
    if (!order) {
      throw new NotFoundException(
        `Order ${entry.orderId} not found for assignment`,
      );
    }
    const maxAttempts = await this.effectiveMaxAttempts(order.sellerId);

    const endedAt = input.endedAt;
    const durationSeconds = endedAt
      ? Math.max(
          0,
          Math.round((endedAt.getTime() - input.startedAt.getTime()) / 1000),
        )
      : undefined;

    // 3. ATOMIC: prior-count → resolve → append attempt → close entry →
    //    audit. (Count BEFORE the insert so it is exactly the resolver's
    //    `priorAttemptCount`; the resolver adds +1 itself for a counting
    //    outcome — CC-5.)
    const { attemptId, resolved } = await this.prisma.client.$transaction(
      async (tx) => {
        const priorAttemptCount = await tx.callAttempt.count({
          where: {
            orderId: entry.orderId,
            outcome: { in: this.countingOutcomes },
          },
        });

        const r = this.mapping.resolve(input.outcome, {
          priorAttemptCount,
          maxAttempts,
        });

        const attempt = await tx.callAttempt.create({
          data: {
            queueEntryId: entry.id,
            orderId: entry.orderId,
            agentId: input.agentId,
            startedAt: input.startedAt,
            ...(endedAt ? { endedAt } : {}),
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
            phoneE164: order.recipient.phoneE164,
            outcome: input.outcome,
            ...(input.outcomeNotes
              ? { outcomeNotes: input.outcomeNotes }
              : {}),
            ...(input.customerSaidName
              ? { customerSaidName: input.customerSaidName }
              : {}),
            ...(input.customerSaidAddress
              ? { customerSaidAddress: input.customerSaidAddress }
              : {}),
            ...(input.customerVerifiedItems !== undefined
              ? { customerVerifiedItems: input.customerVerifiedItems }
              : {}),
            ...(agentScheduledFor
              ? { rescheduledFor: agentScheduledFor }
              : {}),
            ...(input.rescheduledReason
              ? { rescheduledReason: input.rescheduledReason }
              : {}),
            ...(input.flaggedAsSuspicious !== undefined
              ? { flaggedAsSuspicious: input.flaggedAsSuspicious }
              : {}),
            ...(input.suspicionReason
              ? { suspicionReason: input.suspicionReason }
              : {}),
          },
          select: { id: true },
        });

        // Close THIS entry. Locked decision #2: a fresh OPEN entry is
        // created post-commit on re-queue; the COMPLETED rows are the
        // per-attempt history. closureReason is best-effort (see helper).
        await tx.callQueueEntry.update({
          where: { id: entry.id },
          data: {
            status: CallQueueStatus.COMPLETED,
            closedAt: now,
            closureReason: this.closureReasonFor(r),
          },
        });

        await this.audit.log(
          {
            actorType: ActorType.STAFF,
            actorId: input.agentId,
            sellerId: order.sellerId,
            action: 'call_attempt.recorded',
            entityType: 'call_attempt',
            entityId: attempt.id,
            severity: 'LOW',
            metadata: {
              orderId: entry.orderId,
              queueEntryId: entry.id,
              outcome: input.outcome,
              targetStatus: r.targetStatus,
              hitCap: r.hitCap,
              requeue: r.requeue,
              priorAttemptCount,
              maxAttempts,
              ipAddress: input.ctx?.ipAddress ?? null,
              userAgent: input.ctx?.userAgent ?? null,
              requestId: input.ctx?.requestId ?? null,
            },
          },
          tx,
        );

        return { attemptId: attempt.id, resolved: r };
      },
    );

    // 4. POST-COMMIT saga — drive the order transition. The attempt is
    //    the source of truth (CC-3): a failure is logged + audited HIGH
    //    and swallowed, never rolling back the recorded attempt.
    let finalOrderStatus: OrderStatus | null = null;
    if (resolved.targetStatus !== null) {
      try {
        const res = await this.orderWrites.transitionStatus({
          orderId: entry.orderId,
          to: resolved.targetStatus,
          actor: { type: ActorType.STAFF, id: input.agentId },
          reason: `Call outcome ${input.outcome} (attempt ${attemptId})`,
          ...(input.ctx ? { ctx: input.ctx } : {}),
        });
        finalOrderStatus = res.status;
      } catch (e) {
        const err = e as Error;
        this.logger.error(
          {
            orderId: entry.orderId,
            attemptId,
            targetStatus: resolved.targetStatus,
            err: err.message,
          },
          'Post-commit order transition failed after recording call attempt',
        );
        await this.audit.log({
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId: order.sellerId,
          action: 'call_attempt.transition_failed',
          entityType: 'order',
          entityId: entry.orderId,
          severity: 'HIGH',
          metadata: {
            attemptId,
            queueEntryId: entry.id,
            outcome: input.outcome,
            targetStatus: resolved.targetStatus,
            error: err.message,
          },
        });
      }
    }

    // 5. POST-COMMIT re-queue (best-effort).
    let requeuedAvailableAt: Date | null = null;
    if (resolved.requeue && !resolved.hitCap) {
      const availableAt = await this.resolveRequeueAvailableAt(
        resolved.reschedule,
        now,
        agentScheduledFor,
      );
      try {
        await this.queue.enqueueAgain(entry.orderId, availableAt, input.ctx);
        requeuedAvailableAt = availableAt;
      } catch (e) {
        this.logger.error(
          {
            orderId: entry.orderId,
            attemptId,
            err: (e as Error).message,
          },
          'Post-commit re-queue failed; order has no open queue entry until admin re-enqueue',
        );
      }
    }

    return {
      attemptId,
      queueEntryId: entry.id,
      outcome: input.outcome,
      targetStatus: resolved.targetStatus,
      finalOrderStatus,
      hitCap: resolved.hitCap,
      requeued: requeuedAvailableAt !== null,
      requeuedAvailableAt,
    };
  }

  /** An agent's own attempt history (CC-1 rows are immutable facts),
   *  newest first, paginated. Read-only — never mutates call_attempts. */
  async listHistory(
    agentId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    items: Array<{
      attemptId: string;
      orderId: string;
      queueEntryId: string;
      outcome: CallOutcome;
      startedAt: Date;
      endedAt: Date | null;
      durationSeconds: number | null;
      outcomeNotes: string | null;
      rescheduledFor: Date | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = { agentId };
    const [rows, total] = await Promise.all([
      this.prisma.client.callAttempt.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderId: true,
          queueEntryId: true,
          outcome: true,
          startedAt: true,
          endedAt: true,
          durationSeconds: true,
          outcomeNotes: true,
          rescheduledFor: true,
        },
      }),
      this.prisma.client.callAttempt.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        attemptId: r.id,
        orderId: r.orderId,
        queueEntryId: r.queueEntryId,
        outcome: r.outcome,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSeconds: r.durationSeconds,
        outcomeNotes: r.outcomeNotes,
        rescheduledFor: r.rescheduledFor,
      })),
      total,
      page,
      pageSize,
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** Best-effort closure reason for the entry this attempt closes.
   *  Re-queued / no-terminal-state outcomes have NO matching
   *  QueueClosureReason value — the order is still in flight and the
   *  entry is merely SUPERSEDED by the freshly-enqueued retry, so the
   *  (nullable) column is left NULL rather than mislabelled. Tracked as
   *  Phase-1A debt (final-stretch commit). */
  private closureReasonFor(r: ResolvedOutcome): QueueClosureReason | null {
    if (r.targetStatus === OrderStatus.CONFIRMED) {
      return QueueClosureReason.ORDER_CONFIRMED;
    }
    if (r.targetStatus === OrderStatus.REJECTED_BY_CUSTOMER) {
      return QueueClosureReason.ORDER_REJECTED;
    }
    if (r.hitCap || r.targetStatus === OrderStatus.REJECTED_NDR) {
      return QueueClosureReason.MAX_ATTEMPTS_EXCEEDED;
    }
    return null;
  }

  private async resolveRequeueAvailableAt(
    kind: RescheduleKind,
    now: Date,
    agentScheduledFor: Date | null,
  ): Promise<Date> {
    switch (kind) {
      case 'BUSY_DELAY': {
        const hours = await this.busyDelayHours();
        return new Date(now.getTime() + hours * MS_PER_HOUR);
      }
      case 'AGENT_PROVIDED':
        return agentScheduledFor ?? now; // validated upstream; defensive
      case 'IMMEDIATE':
      case 'NONE':
      default:
        return now;
    }
  }

  /** sellers.callMaxAttemptsBeforeNdrOverride ??
   *  ops.call_max_attempts_before_ndr ?? hard default. */
  private async effectiveMaxAttempts(sellerId: string): Promise<number> {
    const [seller, setting] = await Promise.all([
      this.prisma.client.seller.findUnique({
        where: { id: sellerId },
        select: { callMaxAttemptsBeforeNdrOverride: true },
      }),
      this.prisma.client.systemSetting.findUnique({
        where: { key: SETTING_MAX_ATTEMPTS },
        select: { valueInt: true },
      }),
    ]);
    return (
      seller?.callMaxAttemptsBeforeNdrOverride ??
      setting?.valueInt ??
      DEFAULT_MAX_ATTEMPTS
    );
  }

  private async rescheduleBounds(): Promise<{
    minHours: number;
    maxDays: number;
  }> {
    const [minRow, maxRow] = await Promise.all([
      this.prisma.client.systemSetting.findUnique({
        where: { key: SETTING_RESCHEDULE_MIN_HOURS },
        select: { valueInt: true },
      }),
      this.prisma.client.systemSetting.findUnique({
        where: { key: SETTING_RESCHEDULE_MAX_DAYS },
        select: { valueInt: true },
      }),
    ]);
    return {
      minHours: minRow?.valueInt ?? DEFAULT_RESCHEDULE_MIN_HOURS,
      maxDays: maxRow?.valueInt ?? DEFAULT_RESCHEDULE_MAX_DAYS,
    };
  }

  private async busyDelayHours(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: SETTING_BUSY_DELAY_HOURS },
      select: { valueInt: true },
    });
    return row?.valueInt ?? DEFAULT_BUSY_DELAY_HOURS;
  }
}
