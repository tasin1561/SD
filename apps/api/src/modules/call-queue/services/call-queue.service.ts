import { Injectable, Logger } from '@nestjs/common';
import { ActorType, CallQueueStatus, Prisma, QueueClosureReason } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { CallQueueReason } from '@skydrop/db';

const OPEN_STATUSES: CallQueueStatus[] = [CallQueueStatus.PENDING, CallQueueStatus.ASSIGNED];

const ENTRY_SELECT = {
  id: true,
  orderId: true,
  status: true,
  assignedAgentId: true,
  assignedAt: true,
  availableAt: true,
  scheduledAttempts: true,
  closedAt: true,
  closureReason: true,
  reason: true,
  createdAt: true,
} as const;

export type CallQueueEntryView = Prisma.CallQueueEntryGetPayload<{
  select: typeof ENTRY_SELECT;
}>;

export interface EnqueueResult {
  entry: CallQueueEntryView;
  /** false when an OPEN entry already existed (idempotent no-op). */
  created: boolean;
}

export interface DequeueResult {
  dequeued: number;
  /** true if any closed entry had been ASSIGNED to an agent (their
   *  in-flight pull was preempted — audited). */
  preemptedAssigned: boolean;
}

/**
 * Module 7 — the queue PRIMITIVE (shared `call-queue` module, R3).
 *
 * Deliberately has NO Order dependency: enqueue/dequeue operate purely
 * on `call_queue_entries` keyed by `orderId`. Order-status gating ("only
 * enqueue when entering PENDING_CONFIRMATION") is the CALLER's concern
 * (order module hooks) — the primitive does not read order state. Both
 * `call-center` and `order` import this; it imports neither, so the R3
 * split removes the would-be circular module dependency.
 *
 * Invariant (DB-enforced by partial unique
 * `call_queue_entries_open_order_uq`): at most ONE open (PENDING/
 * ASSIGNED) entry per order; COMPLETED/EXPIRED rows accumulate as the
 * per-attempt history (locked decision #2). All three mutators are
 * idempotent and race-safe against that index.
 *
 * `pullNext` is intentionally NOT here — it needs OrderReadService
 * enrichment and lives in call-center's CallAssignmentService.
 */
@Injectable()
export class CallQueueService {
  private readonly logger = new Logger(CallQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Enqueue on entry to PENDING_CONFIRMATION. Idempotent: an existing
   *  OPEN entry is returned unchanged (no second row). */
  async enqueueOrder(
    orderId: string,
    _ctx?: ClientContext,
    reason: CallQueueReason = CallQueueReason.ORDER_CONFIRMATION,
  ): Promise<EnqueueResult> {
    return this.createOpenEntry(orderId, new Date(), reason);
  }

  /** Re-queue after a call attempt (post-commit, CC-6). `availableAt`
   *  is the earliest pickable time (now / now+busyDelay / agent
   *  scheduledFor). Idempotent against the partial unique. */
  async enqueueAgain(
    orderId: string,
    availableAt: Date,
    _ctx?: ClientContext,
    reason: CallQueueReason = CallQueueReason.ORDER_CONFIRMATION,
  ): Promise<EnqueueResult> {
    return this.createOpenEntry(orderId, availableAt, reason);
  }

  /**
   * Dequeue on exit from PENDING_CONFIRMATION. Closes every OPEN entry
   * for the order (→ COMPLETED + closureReason + closedAt). Idempotent:
   * no OPEN entry ⇒ no-op `{ dequeued: 0 }`. An ASSIGNED entry being
   * closed means an agent's in-flight pull was preempted — audited.
   */
  async dequeueOrder(
    orderId: string,
    closureReason: QueueClosureReason,
    ctx?: ClientContext,
  ): Promise<DequeueResult> {
    const open = await this.prisma.client.callQueueEntry.findMany({
      where: { orderId, status: { in: OPEN_STATUSES } },
      select: { id: true, status: true, assignedAgentId: true },
    });
    if (open.length === 0) return { dequeued: 0, preemptedAssigned: false };

    const now = new Date();
    await this.prisma.client.callQueueEntry.updateMany({
      where: { orderId, status: { in: OPEN_STATUSES } },
      data: {
        status: CallQueueStatus.COMPLETED,
        closedAt: now,
        closureReason,
      },
    });

    const preempted = open.filter(
      (e) => e.status === CallQueueStatus.ASSIGNED && e.assignedAgentId,
    );
    const firstPreempted = preempted[0];
    if (firstPreempted) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: 'call_queue.assigned_entry_preempted',
        entityType: 'call_queue_entry',
        entityId: firstPreempted.id,
        severity: 'MEDIUM',
        metadata: {
          orderId,
          closureReason,
          preemptedAgentIds: preempted.map((e) => e.assignedAgentId),
          count: preempted.length,
          ipAddress: ctx?.ipAddress ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
        },
      });
      this.logger.warn(
        { orderId, closureReason, count: preempted.length },
        'dequeueOrder preempted ASSIGNED queue entr(y/ies)',
      );
    }
    return { dequeued: open.length, preemptedAssigned: preempted.length > 0 };
  }

  // ── internal ──────────────────────────────────────────────────────

  private async createOpenEntry(
    orderId: string,
    availableAt: Date,
    reason: CallQueueReason,
  ): Promise<EnqueueResult> {
    const existing = await this.findOpen(orderId);
    if (existing) return { entry: existing, created: false };
    try {
      const entry = await this.prisma.client.callQueueEntry.create({
        // The reason is recorded HERE, at creation, because it cannot be
        // worked out afterwards. Inferring it later is what put the
        // wrong words in front of an agent: the screen looked for any
        // executed recall on the order and found one from the previous
        // day that had already been handled.
        data: { orderId, status: CallQueueStatus.PENDING, availableAt, reason },
        select: ENTRY_SELECT,
      });
      return { entry, created: true };
    } catch (e) {
      // Lost the race to the partial unique — another concurrent
      // enqueue created the OPEN entry. Return it (idempotent).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const won = await this.findOpen(orderId);
        if (won) return { entry: won, created: false };
      }
      throw e;
    }
  }

  private async findOpen(orderId: string): Promise<CallQueueEntryView | null> {
    return this.prisma.client.callQueueEntry.findFirst({
      where: { orderId, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'asc' },
      select: ENTRY_SELECT,
    });
  }
}
