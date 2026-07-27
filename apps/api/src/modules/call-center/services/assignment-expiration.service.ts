import { Injectable, Logger } from '@nestjs/common';
import { ActorType, CallQueueStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { AssignmentExpirationQueue } from '../queue/assignment-expiration.queue';

/** Effective timeout when ops.call_assignment_timeout_minutes is unset —
 *  mirrors the seeded default. */
const DEFAULT_TIMEOUT_MINUTES = 30;
const TIMEOUT_SETTING_KEY = 'ops.call_assignment_timeout_minutes';

export interface ExpireResult {
  /** true ⇒ this call performed the revert; false ⇒ idempotent no-op
   *  (already reassigned / dequeued / reverted by an earlier delivery). */
  expired: boolean;
}

/**
 * Module 7 — CC-7 assignment expiration.
 *
 * A pulled entry is ASSIGNED; if the agent neither completes nor
 * releases the call within ops.call_assignment_timeout_minutes the row
 * must return to the FIFO queue so the order isn't stranded. A delayed
 * BullMQ job (scheduled by CallAssignmentService.pullNext) fires here.
 *
 * Idempotency is TIME-BASED, not flag-based (CC-7): the job carries the
 * assignedAt it was scheduled for, and the revert is a guarded
 * conditional updateMany on (status=ASSIGNED, that exact assignedAt).
 * Any of —
 *   - entry already COMPLETED (dequeued) / EXPIRED
 *   - entry already PENDING (an earlier delivery reverted it)
 *   - entry re-ASSIGNED with a newer assignedAt (revert → re-pull)
 * — makes the delivery a safe no-op, so BullMQ retries, duplicate
 * deliveries, and an old timer racing a fresh re-pull can never
 * double-expire or steal a new agent's assignment. `availableAt` is left
 * untouched so the row keeps its original FIFO position on re-pick.
 */
@Injectable()
export class AssignmentExpirationService {
  private readonly logger = new Logger(AssignmentExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly queue: AssignmentExpirationQueue,
  ) {}

  /** Effective timeout (minutes): ops.call_assignment_timeout_minutes,
   *  else the seeded default. */
  private async timeoutMinutes(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: TIMEOUT_SETTING_KEY },
      select: { valueInt: true },
    });
    return row?.valueInt ?? DEFAULT_TIMEOUT_MINUTES;
  }

  /** Schedule the delayed expiry sweep for a freshly-ASSIGNED entry.
   *  Called post-assignment by CallAssignmentService.pullNext. */
  async scheduleExpiration(assignmentId: string, assignedAt: Date): Promise<void> {
    const minutes = await this.timeoutMinutes();
    await this.queue.enqueueExpiration(
      { assignmentId, assignedAtIso: assignedAt.toISOString() },
      minutes * 60_000,
    );
  }

  /**
   * Time-based idempotent expiry. Reverts ASSIGNED→PENDING (clearing the
   * agent) only when the entry is still ASSIGNED with the exact
   * assignedAt this job was scheduled for; otherwise a no-op. Public so
   * it doubles as the manual trigger for tests / ops tooling.
   */
  async expire(assignmentId: string, assignedAtIso: string): Promise<ExpireResult> {
    const entry = await this.prisma.client.callQueueEntry.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        assignedAgentId: true,
        assignedAt: true,
      },
    });
    if (
      !entry ||
      entry.status !== CallQueueStatus.ASSIGNED ||
      !entry.assignedAt ||
      entry.assignedAt.toISOString() !== assignedAtIso
    ) {
      return { expired: false }; // stale / already-handled — no-op
    }

    const priorAgentId = entry.assignedAgentId;
    // Guard the revert on the (status, assignedAt) it was scheduled for
    // so two concurrent deliveries can't both win the race (no tx needed
    // — this single conditional UPDATE is the atomic CAS).
    const { count } = await this.prisma.client.callQueueEntry.updateMany({
      where: {
        id: assignmentId,
        status: CallQueueStatus.ASSIGNED,
        assignedAt: entry.assignedAt,
      },
      data: {
        status: CallQueueStatus.PENDING,
        assignedAgentId: null,
        assignedAt: null,
      },
    });
    if (count === 0) return { expired: false }; // lost the race — no-op

    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: 'call_queue.assignment_expired',
      entityType: 'call_queue_entry',
      entityId: assignmentId,
      severity: 'MEDIUM',
      metadata: {
        orderId: entry.orderId,
        priorAgentId,
        assignedAt: assignedAtIso,
      },
    });
    this.logger.warn(
      { assignmentId, orderId: entry.orderId, priorAgentId },
      'Assignment expired — entry returned to PENDING queue',
    );
    return { expired: true };
  }
}
