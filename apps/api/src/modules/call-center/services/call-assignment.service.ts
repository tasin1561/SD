import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, CallQueueStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  OrderReadService,
  type ResolvedOrder,
} from '../../order/services/order-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { AssignmentExpirationService } from './assignment-expiration.service';

/** Effective concurrent-assignment cap when an agent has no settings
 *  row — mirrors agent_call_settings.maxActiveCalls @default(1). */
const DEFAULT_MAX_ACTIVE = 1;

export interface PulledAssignment {
  assignmentId: string;
  orderId: string;
  assignedAt: Date;
  scheduledAttempts: number;
  /** Order snapshot for the agent's call (recipient + items). null only
   *  if the referenced order vanished (data anomaly — logged). */
  order: ResolvedOrder | null;
}

/**
 * Module 7 — pull-model assignment (locked decisions #1 strict FIFO,
 * #4 pull). Lives in `call-center` (NOT the queue primitive) because it
 * enriches the assignment via OrderReadService — the first call-center →
 * Order DI consumption.
 *
 * Concurrency (locked decision): the pickable row is selected with
 * `FOR UPDATE SKIP LOCKED LIMIT 1` inside the same tx that flips it to
 * ASSIGNED, so two agents clicking "next" simultaneously can never get
 * the same entry (one gets the next row, or QUEUE_EMPTY). Postgres-
 * native — no advisory locks.
 *
 * FIFO = `ORDER BY available_at ASC, created_at ASC`; future-scheduled
 * entries (`available_at > now()`) are not yet pickable (reschedule /
 * busy-delay honoring). The agent's concurrent cap (10a) is enforced
 * BEFORE locking a row.
 */
@Injectable()
export class CallAssignmentService {
  private readonly logger = new Logger(CallAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly expiration: AssignmentExpirationService,
    private readonly audit: AuditLogService,
  ) {}

  /** Returns the assigned entry (+ order snapshot), or `null` when no
   *  entry is currently pickable (QUEUE_EMPTY). Throws 409
   *  AGENT_AT_CAPACITY when the agent is already at their cap. */
  async pullNext(
    agentId: string,
    _ctx?: ClientContext,
  ): Promise<PulledAssignment | null> {
    const [activeCount, maxActive] = await Promise.all([
      this.prisma.client.callQueueEntry.count({
        where: { assignedAgentId: agentId, status: CallQueueStatus.ASSIGNED },
      }),
      this.effectiveMaxActive(agentId),
    ]);
    if (activeCount >= maxActive) {
      throw new ConflictException({
        code: 'AGENT_AT_CAPACITY',
        message: `Agent already holds ${activeCount}/${maxActive} active call(s); complete or release one first`,
      });
    }

    const now = new Date();
    const picked = await this.prisma.client.$transaction(async (tx) => {
      // FIFO, only currently-pickable PENDING rows; SKIP LOCKED so
      // concurrent pulls never collide. status literal is not user input.
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM call_queue_entries
           WHERE status = 'pending' AND available_at <= now()
           ORDER BY available_at ASC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
      );
      const id = rows[0]?.id;
      if (id === undefined) return null;
      return tx.callQueueEntry.update({
        where: { id },
        data: {
          status: CallQueueStatus.ASSIGNED,
          assignedAgentId: agentId,
          assignedAt: now,
          scheduledAttempts: { increment: 1 },
        },
        select: { id: true, orderId: true, assignedAt: true, scheduledAttempts: true },
      });
    });

    if (!picked) return null; // QUEUE_EMPTY

    // CC-7: arm the timeout sweep immediately (before enrichment) so a
    // slow/failing OrderReadService can't leave the entry un-expirable.
    await this.expiration.scheduleExpiration(
      picked.id,
      picked.assignedAt ?? now,
    );

    const order = await this.orders.getById(picked.orderId);
    if (!order) {
      this.logger.error(
        { assignmentId: picked.id, orderId: picked.orderId },
        'Pulled queue entry references a missing/soft-deleted order',
      );
    }
    return {
      assignmentId: picked.id,
      orderId: picked.orderId,
      assignedAt: picked.assignedAt ?? now,
      scheduledAttempts: picked.scheduledAttempts,
      order,
    };
  }

  /** The agent's in-flight ASSIGNED entries (+ order snapshots).
   *  Typically 0–1 at the Phase-1A default cap; FIFO-ordered by when
   *  they were pulled. */
  async listCurrent(agentId: string): Promise<PulledAssignment[]> {
    const rows = await this.prisma.client.callQueueEntry.findMany({
      where: { assignedAgentId: agentId, status: CallQueueStatus.ASSIGNED },
      orderBy: { assignedAt: 'asc' },
      select: {
        id: true,
        orderId: true,
        assignedAt: true,
        scheduledAttempts: true,
      },
    });
    if (rows.length === 0) return [];
    const orders = await this.orders.getManyByIds(rows.map((r) => r.orderId));
    return rows.map((r) => ({
      assignmentId: r.id,
      orderId: r.orderId,
      assignedAt: r.assignedAt ?? new Date(),
      scheduledAttempts: r.scheduledAttempts,
      order: orders.get(r.orderId) ?? null,
    }));
  }

  /**
   * Agent abandons an assignment WITHOUT recording an attempt — the
   * entry returns to PENDING for FIFO re-pick (availableAt untouched →
   * original queue position preserved). Guarded conditional updateMany
   * on (ASSIGNED, owned by this agent) so it can't race a concurrent
   * expiry / completion. 404 / 409 ASSIGNMENT_NOT_ACTIVE / 403
   * ASSIGNMENT_NOT_OWNED.
   */
  async release(
    assignmentId: string,
    agentId: string,
    ctx?: ClientContext,
  ): Promise<{ released: boolean }> {
    const entry = await this.prisma.client.callQueueEntry.findUnique({
      where: { id: assignmentId },
      select: { id: true, orderId: true, status: true, assignedAgentId: true },
    });
    if (!entry) {
      throw new NotFoundException(`Assignment ${assignmentId} not found`);
    }
    if (entry.status !== CallQueueStatus.ASSIGNED) {
      throw new ConflictException({
        code: 'ASSIGNMENT_NOT_ACTIVE',
        message: `Assignment is ${entry.status}, not ASSIGNED`,
      });
    }
    if (entry.assignedAgentId !== agentId) {
      throw new ForbiddenException({
        code: 'ASSIGNMENT_NOT_OWNED',
        message: 'Assignment is held by another agent',
      });
    }

    const { count } = await this.prisma.client.callQueueEntry.updateMany({
      where: {
        id: assignmentId,
        status: CallQueueStatus.ASSIGNED,
        assignedAgentId: agentId,
      },
      data: {
        status: CallQueueStatus.PENDING,
        assignedAgentId: null,
        assignedAt: null,
      },
    });
    if (count === 0) return { released: false }; // lost a race — no-op

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: agentId,
      action: 'call_queue.assignment_released',
      entityType: 'call_queue_entry',
      entityId: assignmentId,
      severity: 'LOW',
      metadata: {
        orderId: entry.orderId,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
    return { released: true };
  }

  /** agent_call_settings.maxActiveCalls (locked decision 10a cap),
   *  defaulting to 1 when the agent has no settings row. */
  private async effectiveMaxActive(agentId: string): Promise<number> {
    const settings = await this.prisma.client.agentCallSettings.findUnique({
      where: { agentId },
      select: { maxActiveCalls: true },
    });
    return settings?.maxActiveCalls ?? DEFAULT_MAX_ACTIVE;
  }
}
