import { CallQueueStatus } from '@skydrop/db';
import { CallAssignmentService } from '../../src/modules/call-center/services/call-assignment.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { AssignmentExpirationService } from '../../src/modules/call-center/services/assignment-expiration.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    activeCount?: number;
    maxActive?: number | null; // null → no settings row
    picked?: { id: string; orderId: string } | null;
    order?: AnyArgs | null;
    /** Rows the seller lookup returns (the agent's "ordered from" line). */
    sellers?: AnyArgs[];
    currentRows?: AnyArgs[];
    releaseEntry?: AnyArgs | null; // findUnique for release(); undefined → default ASSIGNED owned
    releaseUpdateCount?: number;
    /** Simulate FOR UPDATE SKIP LOCKED: the pickable row is returned to
     *  the FIRST locking SELECT only; concurrent SELECTs skip it (→ []). */
    skipLockedOnce?: boolean;
  } = {},
) {
  const count = jest.fn<Promise<number>, [AnyArgs]>(async () => opts.activeCount ?? 0);
  const agentSettingsFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.maxActive === null || opts.maxActive === undefined
      ? null
      : { maxActiveCalls: opts.maxActive },
  );
  let lockClaimed = false;
  const queryRawUnsafe = jest.fn<Promise<Array<{ id: string }>>, [string]>(async () => {
    if (!opts.picked) return [];
    if (opts.skipLockedOnce) {
      if (lockClaimed) return []; // row already locked by the winner
      lockClaimed = true;
    }
    return [{ id: opts.picked.id }];
  });
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    id: opts.picked?.id ?? 'q1',
    orderId: opts.picked?.orderId ?? 'o1',
    assignedAt: new Date('2026-05-18T10:00:00Z'),
    scheduledAttempts: 1,
  }));
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => opts.currentRows ?? []);
  const defaultReleaseEntry = {
    id: 'q1',
    orderId: 'o1',
    status: CallQueueStatus.ASSIGNED,
    assignedAgentId: 'agent-1',
  };
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.releaseEntry === undefined ? defaultReleaseEntry : opts.releaseEntry,
  );
  const updateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.releaseUpdateCount ?? 1,
  }));
  const txClient = { $queryRawUnsafe: queryRawUnsafe, callQueueEntry: { update } };
  // The assignment carries WHO the customer bought from — the agent's
  // opening line. Empty by default; a test that cares supplies rows.
  const sellerFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => opts.sellers ?? []);
  const client = {
    callQueueEntry: { count, findMany, findUnique, updateMany },
    agentCallSettings: { findUnique: agentSettingsFindUnique },
    seller: { findMany: sellerFindMany },
  } as {
    callQueueEntry: {
      count: typeof count;
      findMany: typeof findMany;
      findUnique: typeof findUnique;
      updateMany: typeof updateMany;
    };
    agentCallSettings: { findUnique: typeof agentSettingsFindUnique };
    seller: { findMany: typeof sellerFindMany };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const orders = {
    getById: jest.fn(async () => (opts.order === undefined ? { orderId: 'o1' } : opts.order)),
    getManyByIds: jest.fn(async () => new Map((opts.currentRows ?? []).map((r) => [r.orderId, r]))),
  };
  const scheduleExpiration = jest.fn<Promise<void>, [string, Date]>(async () => {});
  const expiration = { scheduleExpiration };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };
  const svc = new CallAssignmentService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    expiration as unknown as AssignmentExpirationService,
    audit as unknown as AuditLogService,
  );
  return {
    svc,
    count,
    agentSettingsFindUnique,
    queryRawUnsafe,
    update,
    orders,
    scheduleExpiration,
    findMany,
    findUnique,
    updateMany,
    auditLog,
  };
}

describe('CallAssignmentService.pullNext', () => {
  it('returns null (QUEUE_EMPTY) when no entry is pickable', async () => {
    const { svc, update, scheduleExpiration } = makeService({ picked: null });
    expect(await svc.pullNext('agent-1')).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(scheduleExpiration).not.toHaveBeenCalled();
  });

  it('locks FIFO + assigns + enriches via OrderReadService', async () => {
    const { svc, queryRawUnsafe, update, orders, scheduleExpiration } = makeService({
      picked: { id: 'q1', orderId: 'o1' },
      order: { orderId: 'o1', recipient: { name: 'Asha' } },
    });
    const r = await svc.pullNext('agent-1');
    expect(r).not.toBeNull();
    expect(scheduleExpiration).toHaveBeenCalledWith('q1', new Date('2026-05-18T10:00:00Z'));
    const sql = queryRawUnsafe.mock.calls[0]![0];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('ORDER BY available_at ASC, created_at ASC');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('available_at <= now()');
    const data = update.mock.calls[0]![0].data as AnyArgs;
    expect(data).toMatchObject({
      status: CallQueueStatus.ASSIGNED,
      assignedAgentId: 'agent-1',
    });
    expect(orders.getById).toHaveBeenCalledWith('o1');
    expect(r!.order).toMatchObject({ orderId: 'o1' });
  });

  it('throws 409 AGENT_AT_CAPACITY at the cap (default 1, no settings)', async () => {
    const { svc, queryRawUnsafe } = makeService({ activeCount: 1, maxActive: null });
    await expect(svc.pullNext('agent-1')).rejects.toMatchObject({
      response: { code: 'AGENT_AT_CAPACITY' },
    });
    expect(queryRawUnsafe).not.toHaveBeenCalled(); // cap checked before locking
  });

  it('honors a raised per-agent cap (maxActiveCalls=3)', async () => {
    const { svc } = makeService({
      activeCount: 2,
      maxActive: 3,
      picked: { id: 'q1', orderId: 'o1' },
    });
    await expect(svc.pullNext('agent-1')).resolves.not.toBeNull(); // 2 < 3
  });

  it('returns assignment with order=null when the order vanished (logged)', async () => {
    const { svc } = makeService({ picked: { id: 'q1', orderId: 'o1' }, order: null });
    const r = await svc.pullNext('agent-1');
    expect(r!.order).toBeNull();
    expect(r!.assignmentId).toBe('q1');
  });
});

describe('CallAssignmentService.listCurrent', () => {
  it('returns [] when the agent holds no ASSIGNED entries', async () => {
    const { svc, findMany } = makeService({ currentRows: [] });
    expect(await svc.listCurrent('agent-1')).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedAgentId: 'agent-1', status: CallQueueStatus.ASSIGNED },
      }),
    );
  });

  it('enriches in-flight entries with the order snapshot', async () => {
    const { svc } = makeService({
      currentRows: [
        {
          id: 'q1',
          orderId: 'o1',
          assignedAt: new Date('2026-05-18T10:00:00Z'),
          scheduledAttempts: 1,
        },
      ],
    });
    const r = await svc.listCurrent('agent-1');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ assignmentId: 'q1', orderId: 'o1' });
    expect(r[0]!.order).toMatchObject({ orderId: 'o1' });
  });
});

describe('CallAssignmentService.release', () => {
  it('reverts ASSIGNED→PENDING + clears agent + audits (LOW)', async () => {
    const { svc, updateMany, auditLog } = makeService();
    expect(await svc.release('q1', 'agent-1')).toEqual({ released: true });
    const data = updateMany.mock.calls[0]![0].data as AnyArgs;
    expect(data).toMatchObject({
      status: CallQueueStatus.PENDING,
      assignedAgentId: null,
      assignedAt: null,
    });
    expect(auditLog.mock.calls[0]![0]).toMatchObject({
      action: 'call_queue.assignment_released',
      severity: 'LOW',
    });
  });

  it('404 when the assignment does not exist', async () => {
    const { svc } = makeService({ releaseEntry: null });
    await expect(svc.release('q1', 'agent-1')).rejects.toMatchObject({ status: 404 });
  });

  it('409 ASSIGNMENT_NOT_ACTIVE when not ASSIGNED', async () => {
    const { svc } = makeService({
      releaseEntry: {
        id: 'q1',
        orderId: 'o1',
        status: CallQueueStatus.COMPLETED,
        assignedAgentId: 'agent-1',
      },
    });
    await expect(svc.release('q1', 'agent-1')).rejects.toMatchObject({
      response: { code: 'ASSIGNMENT_NOT_ACTIVE' },
    });
  });

  it('403 ASSIGNMENT_NOT_OWNED when held by another agent', async () => {
    const { svc } = makeService({
      releaseEntry: {
        id: 'q1',
        orderId: 'o1',
        status: CallQueueStatus.ASSIGNED,
        assignedAgentId: 'agent-2',
      },
    });
    await expect(svc.release('q1', 'agent-1')).rejects.toMatchObject({
      response: { code: 'ASSIGNMENT_NOT_OWNED' },
    });
  });

  it('no-ops (released:false), skips audit when it loses the update race', async () => {
    const { svc, auditLog } = makeService({ releaseUpdateCount: 0 });
    expect(await svc.release('q1', 'agent-1')).toEqual({ released: false });
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe('CallAssignmentService.pullNext — concurrency (FOR UPDATE SKIP LOCKED)', () => {
  it('two parallel pulls on a 1-entry queue: one ASSIGNED, one QUEUE_EMPTY', async () => {
    const { svc, update } = makeService({
      picked: { id: 'q1', orderId: 'o1' },
      skipLockedOnce: true, // the locked row is invisible to the loser's SELECT
    });
    const [a, b] = await Promise.all([svc.pullNext('agent-1'), svc.pullNext('agent-2')]);
    const got = [a, b].filter((r) => r !== null);
    const empty = [a, b].filter((r) => r === null);
    expect(got).toHaveLength(1); // exactly one winner
    expect(empty).toHaveLength(1); // the other sees QUEUE_EMPTY
    expect(got[0]!.assignmentId).toBe('q1');
    expect(update).toHaveBeenCalledTimes(1); // only the winner flips → ASSIGNED
  });
});
