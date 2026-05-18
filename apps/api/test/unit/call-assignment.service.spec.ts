import { CallQueueStatus } from '@skydrop/db';
import { CallAssignmentService } from '../../src/modules/call-center/services/call-assignment.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';

type AnyArgs = Record<string, unknown>;

function makeService(opts: {
  activeCount?: number;
  maxActive?: number | null; // null → no settings row
  picked?: { id: string; orderId: string } | null;
  order?: AnyArgs | null;
} = {}) {
  const count = jest.fn<Promise<number>, [AnyArgs]>(async () => opts.activeCount ?? 0);
  const agentSettingsFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.maxActive === null || opts.maxActive === undefined
      ? null
      : { maxActiveCalls: opts.maxActive },
  );
  const queryRawUnsafe = jest.fn<Promise<Array<{ id: string }>>, [string]>(async () =>
    opts.picked ? [{ id: opts.picked.id }] : [],
  );
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    id: opts.picked?.id ?? 'q1',
    orderId: opts.picked?.orderId ?? 'o1',
    assignedAt: new Date('2026-05-18T10:00:00Z'),
    scheduledAttempts: 1,
  }));
  const txClient = { $queryRawUnsafe: queryRawUnsafe, callQueueEntry: { update } };
  const client = {
    callQueueEntry: { count },
    agentCallSettings: { findUnique: agentSettingsFindUnique },
  } as {
    callQueueEntry: { count: typeof count };
    agentCallSettings: { findUnique: typeof agentSettingsFindUnique };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const orders = {
    getById: jest.fn(async () => (opts.order === undefined ? { orderId: 'o1' } : opts.order)),
  };
  const svc = new CallAssignmentService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
  );
  return { svc, count, agentSettingsFindUnique, queryRawUnsafe, update, orders };
}

describe('CallAssignmentService.pullNext', () => {
  it('returns null (QUEUE_EMPTY) when no entry is pickable', async () => {
    const { svc, update } = makeService({ picked: null });
    expect(await svc.pullNext('agent-1')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('locks FIFO + assigns + enriches via OrderReadService', async () => {
    const { svc, queryRawUnsafe, update, orders } = makeService({
      picked: { id: 'q1', orderId: 'o1' },
      order: { orderId: 'o1', recipient: { name: 'Asha' } },
    });
    const r = await svc.pullNext('agent-1');
    expect(r).not.toBeNull();
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
