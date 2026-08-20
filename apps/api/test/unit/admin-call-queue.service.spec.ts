import { CallQueueStatus, QueueClosureReason } from '@skydrop/db';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';
import { AdminCallQueueService } from '../../src/modules/call-center/services/admin-call-queue.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { CallAttemptService } from '../../src/modules/call-center/services/call-attempt.service';
import type { CallQueueService } from '../../src/modules/call-queue/services/call-queue.service';
import type { AssignmentExpirationService } from '../../src/modules/call-center/services/assignment-expiration.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    rows?: AnyArgs[];
    total?: number;
    byStatus?: AnyArgs[];
    assigned?: AnyArgs[];
    entry?: AnyArgs | null;
    target?: AnyArgs | null;
    openOrders?: AnyArgs[];
  } = {},
) {
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async (a) =>
    a.distinct ? (opts.openOrders ?? []) : (opts.rows ?? []),
  );
  const count = jest.fn<Promise<number>, [AnyArgs]>(async () => opts.total ?? 0);
  const groupBy = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async (a) =>
    (a.by as string[]).includes('status') ? (opts.byStatus ?? []) : (opts.assigned ?? []),
  );
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.entry === undefined
      ? {
          id: 'q1',
          orderId: 'o1',
          status: CallQueueStatus.PENDING,
          assignedAgentId: null,
        }
      : opts.entry,
  );
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const staffFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.target === undefined ? { id: 'agent-2' } : opts.target,
  );
  const client = {
    callQueueEntry: { findMany, count, groupBy, findUnique, update },
    // Attempts are counted PER ORDER (a re-queue makes a new entry and
    // the cap does not reset with it) — see admin-call-queue-attempts.
    callAttempt: { groupBy: jest.fn(async () => []) },
    staffUser: { findFirst: staffFindFirst },
  };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };
  const recordAttempt = jest.fn(async () => ({ attemptId: 'att-1' }));
  const attempts = { recordAttempt };
  const dequeueOrder = jest.fn(async () => ({ dequeued: 1, preemptedAssigned: false }));
  const queue = { dequeueOrder };
  const scheduleExpiration = jest.fn<Promise<void>, [string, Date]>(async () => {});
  const expiration = { scheduleExpiration };

  const svc = new AdminCallQueueService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    attempts as unknown as CallAttemptService,
    queue as unknown as CallQueueService,
    expiration as unknown as AssignmentExpirationService,
    // Real instance: it is pure logic with no Prisma, and the row's
    // counting-attempt total is derived through it (CC-2).
    new CallOutcomeMappingService(),
    // Cap resolution lives in CallCapService; these tests are about
    // the queue's shape, not the number.
    {
      grantedExtraByOrder: jest.fn(async () => new Map()),
      baseForSeller: jest.fn(async () => 3),
    } as never,
  );
  return {
    svc,
    findMany,
    count,
    groupBy,
    findUnique,
    update,
    staffFindFirst,
    auditLog,
    recordAttempt,
    dequeueOrder,
    scheduleExpiration,
  };
}

describe('AdminCallQueueService.listQueue', () => {
  it('builds the where (status/seller/agent) + paginates + shapes', async () => {
    const { svc, findMany } = makeService({
      rows: [
        {
          id: 'q1',
          orderId: 'o1',
          status: CallQueueStatus.PENDING,
          assignedAgentId: null,
          assignedAt: null,
          availableAt: new Date(),
          scheduledAttempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
          order: { orderNumber: 'SD-1', sellerId: 's1', status: 'pending_confirmation' },
          assignedAgent: null,
        },
      ],
      total: 1,
    });
    const r = await svc.listQueue({
      status: CallQueueStatus.PENDING,
      sellerId: 's1',
      agentId: 'agent-1',
      page: 2,
      pageSize: 10,
    });
    const args = findMany.mock.calls[0]![0];
    expect(args).toMatchObject({
      where: {
        status: CallQueueStatus.PENDING,
        assignedAgentId: 'agent-1',
        order: { sellerId: 's1' },
      },
      skip: 10,
      take: 10,
    });
    expect(r).toMatchObject({ total: 1, page: 2, pageSize: 10 });
    expect(r.items[0]).toMatchObject({
      id: 'q1',
      order: { orderNumber: 'SD-1' },
      // A queued entry nobody has pulled or phoned: every count zero,
      // and no agent to name.
      attemptsLogged: 0,
      attemptsCounting: 0,
      scheduledAttempts: 0,
      agent: null,
    });
  });
});

describe('AdminCallQueueService.stats', () => {
  it('aggregates byStatus + openTotal + assignedByAgent', async () => {
    const { svc } = makeService({
      byStatus: [
        { status: CallQueueStatus.PENDING, _count: { _all: 5 } },
        { status: CallQueueStatus.ASSIGNED, _count: { _all: 2 } },
        { status: CallQueueStatus.COMPLETED, _count: { _all: 9 } },
      ],
      assigned: [{ assignedAgentId: 'agent-1', _count: { _all: 2 } }],
    });
    const s = await svc.stats();
    expect(s.byStatus).toMatchObject({
      [CallQueueStatus.PENDING]: 5,
      [CallQueueStatus.ASSIGNED]: 2,
      [CallQueueStatus.COMPLETED]: 9,
    });
    expect(s.openTotal).toBe(7);
    expect(s.assignedByAgent).toEqual([{ agentId: 'agent-1', count: 2 }]);
  });
});

describe('AdminCallQueueService.reassign', () => {
  it('404 when entry missing', async () => {
    const { svc } = makeService({ entry: null });
    await expect(svc.reassign('q1', 'agent-2', 'admin-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('409 ENTRY_NOT_OPEN when entry already closed', async () => {
    const { svc } = makeService({
      entry: {
        id: 'q1',
        orderId: 'o1',
        status: CallQueueStatus.COMPLETED,
        assignedAgentId: null,
      },
    });
    await expect(svc.reassign('q1', 'agent-2', 'admin-1')).rejects.toMatchObject({
      response: { code: 'ENTRY_NOT_OPEN' },
    });
  });

  it('404 when the target agent does not exist', async () => {
    const { svc } = makeService({ target: null });
    await expect(svc.reassign('q1', 'ghost', 'admin-1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('reassigns, arms a fresh expiration timer, MEDIUM audit', async () => {
    const { svc, update, scheduleExpiration, auditLog } = makeService();
    const r = await svc.reassign('q1', 'agent-2', 'admin-1');
    expect(update.mock.calls[0]![0].data as AnyArgs).toMatchObject({
      status: CallQueueStatus.ASSIGNED,
      assignedAgentId: 'agent-2',
    });
    expect(scheduleExpiration).toHaveBeenCalledWith('q1', expect.any(Date));
    expect(auditLog.mock.calls[0]![0]).toMatchObject({
      action: 'call_queue.reassigned',
      severity: 'MEDIUM',
    });
    expect(r).toMatchObject({ assignedAgentId: 'agent-2', status: CallQueueStatus.ASSIGNED });
  });
});

describe('AdminCallQueueService.forceOutcome', () => {
  it('delegates to CallAttemptService with forceByAdmin + admin actor', async () => {
    const { svc, recordAttempt } = makeService();
    await svc.forceOutcome(
      'q1',
      { outcome: 'no_answer' as never, startedAt: new Date() },
      'admin-1',
    );
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 'q1',
        agentId: 'admin-1',
        forceByAdmin: true,
      }),
    );
  });
});

describe('AdminCallQueueService.bulkDequeue', () => {
  it('dequeues every OPEN order for the seller + MEDIUM audit', async () => {
    const { svc, dequeueOrder, auditLog } = makeService({
      openOrders: [{ orderId: 'o1' }, { orderId: 'o2' }],
    });
    const r = await svc.bulkDequeue('s1', 'seller suspended', 'admin-1');
    expect(dequeueOrder).toHaveBeenCalledTimes(2);
    expect(dequeueOrder).toHaveBeenCalledWith('o1', QueueClosureReason.ADMIN_CLOSED, undefined);
    expect(r).toEqual({ sellerId: 's1', dequeuedOrders: 2 });
    expect(auditLog.mock.calls[0]![0]).toMatchObject({
      action: 'call_queue.bulk_dequeued',
      severity: 'MEDIUM',
    });
  });

  it('no-op count 0 when the seller has no open entries', async () => {
    const { svc, dequeueOrder } = makeService({ openOrders: [] });
    const r = await svc.bulkDequeue('s1', 'x', 'admin-1');
    expect(dequeueOrder).not.toHaveBeenCalled();
    expect(r.dequeuedOrders).toBe(0);
  });
});
