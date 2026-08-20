import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CALL_QUEUE_VIEW_OPEN } from '../dto/admin-call-queue.dto';
import { ActorType, CallQueueStatus, Prisma, QueueClosureReason } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  CallAttemptService,
  type RecordAttemptInput,
  type RecordAttemptResult,
} from './call-attempt.service';
import { AssignmentExpirationService } from './assignment-expiration.service';
import { CallOutcomeMappingService } from './call-outcome-mapping.service';
import { CallCapService } from './call-cap.service';

const OPEN_STATUSES: CallQueueStatus[] = [CallQueueStatus.PENDING, CallQueueStatus.ASSIGNED];

/**
 * How far ahead a supervisor may push a call. A year out is a typo, not
 * an intention, and an entry parked past every retention sweep is a
 * customer who silently never gets called.
 */
const MAX_RESCHEDULE_DAYS = 90;

/** Only for a row whose order vanished — mirrors the seeded default. */
const DEFAULT_DISPLAY_CAP = 3;

export interface CallQueueAdminRow {
  id: string;
  orderId: string;
  status: CallQueueStatus;
  assignedAgentId: string | null;
  assignedAt: Date | null;
  availableAt: Date;
  /** Times this entry has been PULLED into an agent's station. Counts
   *  claims, not conversations — it increments the moment an agent takes
   *  the row, before any call is made, and again on a re-pull after an
   *  expiry. It is NOT the NDR cap counter. */
  scheduledAttempts: number;
  /** Calls logged against this ORDER (not this entry — a re-queue makes
   *  a new entry, and the cap does not reset with it). */
  attemptsLogged: number;
  /** Of those, the ones that count toward the NDR cap (CC-5's 6 of 9
   *  outcomes). This is the number the cap is judged on, so it is the
   *  one an operator deciding whether an order is nearly out of chances
   *  needs to see. */
  attemptsCounting: number;
  /** The effective cap this entry was created under. */
  maxAttempts: number;
  createdAt: Date;
  order: { orderNumber: string; sellerId: string; status: string } | null;
  agent: { id: string; name: string } | null;
}

export interface CallQueueStats {
  byStatus: Record<string, number>;
  openTotal: number;
  assignedByAgent: Array<{ agentId: string; count: number }>;
}

/**
 * Module 7 — admin queue powers (locked decision 11: view, stats,
 * reassign, force-outcome, bulk-dequeue). Per-queue + per-agent SUMMARY
 * stats only (decision 12 — deep/time-series reporting is Module 13).
 * Internal to call-center (not exported); the only cross-module queue
 * surface remains CallQueueService.
 */
@Injectable()
export class AdminCallQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly attempts: CallAttemptService,
    private readonly queue: CallQueueService,
    private readonly expiration: AssignmentExpirationService,
    private readonly mapping: CallOutcomeMappingService,
    private readonly caps: CallCapService,
  ) {}

  async listQueue(filters: {
    status?: CallQueueStatus | typeof CALL_QUEUE_VIEW_OPEN;
    sellerId?: string;
    agentId?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: CallQueueAdminRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Prisma.CallQueueEntryWhereInput = {};
    // OPEN is the two live statuses together — see the DTO for why it is
    // not a CallQueueStatus.
    if (filters.status === CALL_QUEUE_VIEW_OPEN) {
      where.status = { in: OPEN_STATUSES };
    } else if (filters.status) {
      where.status = filters.status;
    }
    if (filters.agentId) where.assignedAgentId = filters.agentId;
    if (filters.sellerId) where.order = { sellerId: filters.sellerId };

    const [rows, total] = await Promise.all([
      this.prisma.client.callQueueEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: {
          id: true,
          orderId: true,
          status: true,
          assignedAgentId: true,
          assignedAt: true,
          availableAt: true,
          scheduledAttempts: true,
          createdAt: true,
          order: {
            select: { orderNumber: true, sellerId: true, status: true },
          },
          // Staff carry no name — emailDisplay IS the human identity.
          // Without this the column rendered a raw uuid, which tells an
          // operator nothing about who to go and ask.
          assignedAgent: { select: { id: true, emailDisplay: true } },
        },
      }),
      this.prisma.client.callQueueEntry.count({ where }),
    ]);

    // Attempts are counted PER ORDER, not per entry.
    //
    // A re-queue creates a NEW entry (locked decision #2), so a
    // per-entry count resets to 0 on every retry — and the cap column
    // then reads "0/3" for an order already on its second attempt,
    // which makes a working retry chain look like an infinite loop.
    // CC-5 counts `call_attempts` by orderId, so this must too: every
    // row for the same order shows the same figure, because there IS
    // only one figure.
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const attemptRows =
      orderIds.length === 0
        ? []
        : await this.prisma.client.callAttempt.groupBy({
            by: ['orderId', 'outcome'],
            where: { orderId: { in: orderIds } },
            _count: { _all: true },
          });
    // The EFFECTIVE cap, not `call_queue_entries.max_attempts` — that
    // column is a per-entry default predating both the per-seller
    // override and re-attempt grants, and nothing enforces against it. A
    // screen reading 3/3 beside an order the server will happily call
    // twice more is a number people stop trusting.
    const grantedExtra = await this.caps.grantedExtraByOrder(orderIds);
    const sellerIds = [
      ...new Set(
        rows.map((r) => r.order?.sellerId).filter((x): x is string => typeof x === 'string'),
      ),
    ];
    const baseCaps = new Map<string, number>();
    await Promise.all(
      sellerIds.map(async (sid) => {
        baseCaps.set(sid, await this.caps.baseForSeller(sid));
      }),
    );

    const logged = new Map<string, number>();
    const counting = new Map<string, number>();
    for (const a of attemptRows) {
      const n = a._count._all;
      logged.set(a.orderId, (logged.get(a.orderId) ?? 0) + n);
      if (this.mapping.countsTowardCap(a.outcome)) {
        counting.set(a.orderId, (counting.get(a.orderId) ?? 0) + n);
      }
    }
    return {
      items: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        status: r.status,
        assignedAgentId: r.assignedAgentId,
        assignedAt: r.assignedAt,
        availableAt: r.availableAt,
        scheduledAttempts: r.scheduledAttempts,
        attemptsLogged: logged.get(r.orderId) ?? 0,
        // Derived from the mapping service rather than a second copy of
        // the 6-of-9 list (CC-2: the table lives in one place).
        attemptsCounting: counting.get(r.orderId) ?? 0,
        maxAttempts:
          (r.order === null
            ? DEFAULT_DISPLAY_CAP
            : (baseCaps.get(r.order.sellerId) ?? DEFAULT_DISPLAY_CAP)) +
          (grantedExtra.get(r.orderId) ?? 0),
        createdAt: r.createdAt,
        order: r.order
          ? {
              orderNumber: r.order.orderNumber,
              sellerId: r.order.sellerId,
              status: r.order.status,
            }
          : null,
        agent: r.assignedAgent
          ? { id: r.assignedAgent.id, name: r.assignedAgent.emailDisplay }
          : null,
      })),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  async stats(): Promise<CallQueueStats> {
    const [byStatusRows, assignedRows] = await Promise.all([
      this.prisma.client.callQueueEntry.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.client.callQueueEntry.groupBy({
        by: ['assignedAgentId'],
        where: { status: CallQueueStatus.ASSIGNED },
        _count: { _all: true },
      }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) byStatus[row.status] = row._count._all;
    const openTotal =
      (byStatus[CallQueueStatus.PENDING] ?? 0) + (byStatus[CallQueueStatus.ASSIGNED] ?? 0);
    const assignedByAgent = assignedRows
      .filter((r): r is typeof r & { assignedAgentId: string } => Boolean(r.assignedAgentId))
      .map((r) => ({ agentId: r.assignedAgentId, count: r._count._all }));
    return { byStatus, openTotal, assignedByAgent };
  }

  /** Hard-reassign an OPEN entry to a specific agent (decision 11).
   *  Arms a fresh expiration timer so the reassignment can't strand. */
  /**
   * Move WHEN a queued call becomes callable again.
   *
   * The only thing that set `available_at` was the re-queue after an
   * attempt, computed from the outcome — so a supervisor watching an
   * order sit four hours out had no way to bring it forward when the
   * customer rang back, or to push it when they asked for tomorrow.
   * Force-outcome was the only lever, and it works by RECORDING a
   * conversation that did not happen.
   *
   * Deliberately does NOT touch the attempt count: this is about timing,
   * not about pretending a call was or was not made. The cap still
   * decides when the order is out of chances.
   *
   * Allowed on an ASSIGNED entry as well as a PENDING one. It has no
   * effect while an agent holds it — `available_at` is only read when
   * choosing what to hand out — but it is the right value for when the
   * entry returns, and refusing would force a supervisor to wait for an
   * expiry before they could act.
   */
  async reschedule(
    entryId: string,
    availableAt: Date,
    reason: string,
    adminStaffId: string,
    ctx?: ClientContext,
  ): Promise<{ id: string; availableAt: Date; status: CallQueueStatus }> {
    const entry = await this.prisma.client.callQueueEntry.findUnique({
      where: { id: entryId },
      select: { id: true, orderId: true, status: true, availableAt: true },
    });
    if (!entry) {
      throw new NotFoundException(`Queue entry ${entryId} not found`);
    }
    if (!OPEN_STATUSES.includes(entry.status)) {
      throw new ConflictException({
        code: 'ENTRY_NOT_OPEN',
        message: `Entry is ${entry.status} (closed); cannot reschedule`,
      });
    }

    const ceiling = new Date(Date.now() + MAX_RESCHEDULE_DAYS * 24 * 60 * 60_000);
    if (availableAt > ceiling) {
      throw new BadRequestException({
        code: 'RESCHEDULE_TOO_FAR',
        message: `Cannot schedule more than ${MAX_RESCHEDULE_DAYS} days ahead`,
      });
    }

    // A past time is ALLOWED and means "callable now" — that is the
    // whole point of bringing a call forward, and clamping it to now
    // would differ only in a value nobody reads.
    const updated = await this.prisma.client.callQueueEntry.update({
      where: { id: entryId },
      data: { availableAt },
      select: { id: true, availableAt: true, status: true },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: adminStaffId,
      action: 'call_queue.rescheduled',
      entityType: 'call_queue_entry',
      entityId: entryId,
      severity: 'MEDIUM',
      metadata: {
        orderId: entry.orderId,
        from: entry.availableAt.toISOString(),
        to: updated.availableAt.toISOString(),
        reason,
        ...(ctx?.ipAddress !== undefined ? { ipAddress: ctx.ipAddress } : {}),
      },
    });

    return updated;
  }

  async reassign(
    entryId: string,
    toAgentId: string,
    adminStaffId: string,
    ctx?: ClientContext,
  ): Promise<{ id: string; assignedAgentId: string; status: CallQueueStatus }> {
    const entry = await this.prisma.client.callQueueEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        orderId: true,
        status: true,
        assignedAgentId: true,
      },
    });
    if (!entry) {
      throw new NotFoundException(`Queue entry ${entryId} not found`);
    }
    if (!OPEN_STATUSES.includes(entry.status)) {
      throw new ConflictException({
        code: 'ENTRY_NOT_OPEN',
        message: `Entry is ${entry.status} (closed); cannot reassign`,
      });
    }
    const target = await this.prisma.client.staffUser.findFirst({
      where: { id: toAgentId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException(`Agent ${toAgentId} not found`);
    }

    const now = new Date();
    await this.prisma.client.callQueueEntry.update({
      where: { id: entryId },
      data: {
        status: CallQueueStatus.ASSIGNED,
        assignedAgentId: toAgentId,
        assignedAt: now,
      },
    });
    await this.expiration.scheduleExpiration(entryId, now);

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: adminStaffId,
      action: 'call_queue.reassigned',
      entityType: 'call_queue_entry',
      entityId: entryId,
      severity: 'MEDIUM',
      metadata: {
        orderId: entry.orderId,
        fromAgentId: entry.assignedAgentId,
        toAgentId,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
    return { id: entryId, assignedAgentId: toAgentId, status: CallQueueStatus.ASSIGNED };
  }

  /** Admin force-outcome — delegates to the SAME CallAttemptService
   *  (CC-2/CC-3 single source) with the admin actor + forceByAdmin. */
  forceOutcome(
    entryId: string,
    input: Omit<RecordAttemptInput, 'assignmentId' | 'agentId' | 'forceByAdmin'>,
    adminStaffId: string,
  ): Promise<RecordAttemptResult> {
    return this.attempts.recordAttempt({
      ...input,
      assignmentId: entryId,
      agentId: adminStaffId,
      forceByAdmin: true,
    });
  }

  /** Close every OPEN queue entry for a seller (e.g. seller suspended).
   *  Per-order via the idempotent CallQueueService.dequeueOrder so the
   *  ASSIGNED-preemption audit fires. CONFIRMED orders are untouched —
   *  their entries are already COMPLETED. */
  async bulkDequeue(
    sellerId: string,
    reason: string,
    adminStaffId: string,
    ctx?: ClientContext,
  ): Promise<{ sellerId: string; dequeuedOrders: number }> {
    const open = await this.prisma.client.callQueueEntry.findMany({
      where: { status: { in: OPEN_STATUSES }, order: { sellerId } },
      select: { orderId: true },
      distinct: ['orderId'],
    });
    for (const { orderId } of open) {
      await this.queue.dequeueOrder(orderId, QueueClosureReason.ADMIN_CLOSED, ctx);
    }
    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: adminStaffId,
      action: 'call_queue.bulk_dequeued',
      entityType: 'seller',
      entityId: sellerId,
      severity: 'MEDIUM',
      metadata: {
        sellerId,
        reason,
        dequeuedOrders: open.length,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
    return { sellerId, dequeuedOrders: open.length };
  }
}
