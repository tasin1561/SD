import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  CallQueueStatus,
  Prisma,
  QueueClosureReason,
} from '@skydrop/db';
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

const OPEN_STATUSES: CallQueueStatus[] = [
  CallQueueStatus.PENDING,
  CallQueueStatus.ASSIGNED,
];

export interface CallQueueAdminRow {
  id: string;
  orderId: string;
  status: CallQueueStatus;
  assignedAgentId: string | null;
  assignedAt: Date | null;
  availableAt: Date;
  scheduledAttempts: number;
  createdAt: Date;
  order: { orderNumber: string; sellerId: string; status: string } | null;
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
  ) {}

  async listQueue(filters: {
    status?: CallQueueStatus;
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
    if (filters.status) where.status = filters.status;
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
        },
      }),
      this.prisma.client.callQueueEntry.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        status: r.status,
        assignedAgentId: r.assignedAgentId,
        assignedAt: r.assignedAt,
        availableAt: r.availableAt,
        scheduledAttempts: r.scheduledAttempts,
        createdAt: r.createdAt,
        order: r.order
          ? {
              orderNumber: r.order.orderNumber,
              sellerId: r.order.sellerId,
              status: r.order.status,
            }
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
      (byStatus[CallQueueStatus.PENDING] ?? 0) +
      (byStatus[CallQueueStatus.ASSIGNED] ?? 0);
    const assignedByAgent = assignedRows
      .filter((r): r is typeof r & { assignedAgentId: string } =>
        Boolean(r.assignedAgentId),
      )
      .map((r) => ({ agentId: r.assignedAgentId, count: r._count._all }));
    return { byStatus, openTotal, assignedByAgent };
  }

  /** Hard-reassign an OPEN entry to a specific agent (decision 11).
   *  Arms a fresh expiration timer so the reassignment can't strand. */
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
      await this.queue.dequeueOrder(
        orderId,
        QueueClosureReason.ADMIN_CLOSED,
        ctx,
      );
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
