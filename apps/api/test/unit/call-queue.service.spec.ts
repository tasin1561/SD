import { CallQueueStatus, Prisma, QueueClosureReason } from '@skydrop/db';
import { CallQueueService } from '../../src/modules/call-queue/services/call-queue.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    open?: AnyArgs | null;
    openMany?: AnyArgs[];
    createThrowsP2002?: boolean;
  } = {},
) {
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.open === undefined ? null : opts.open,
  );
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => opts.openMany ?? []);
  const create = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => {
    if (opts.createThrowsP2002) {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
    }
    return { id: 'q-new', ...(a.data as AnyArgs) };
  });
  const updateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.openMany?.length ?? 0,
  }));
  const client = { callQueueEntry: { findFirst, findMany, create, updateMany } };
  const audit = { log: jest.fn<Promise<string>, [AnyArgs]>(async () => 'a1') };
  const svc = new CallQueueService({ client } as unknown as PrismaService, audit as never);
  return { svc, findFirst, findMany, create, updateMany, audit };
}

describe('CallQueueService.enqueueOrder / enqueueAgain', () => {
  it('creates a PENDING entry when none is open', async () => {
    const { svc, create } = makeService({ open: null });
    const r = await svc.enqueueOrder('o1');
    expect(r.created).toBe(true);
    const data = create.mock.calls[0]![0].data as AnyArgs;
    expect(data).toMatchObject({ orderId: 'o1', status: CallQueueStatus.PENDING });
    expect(data.availableAt).toBeInstanceOf(Date);
  });

  it('is idempotent — an existing OPEN entry is returned, no create', async () => {
    const { svc, create } = makeService({ open: { id: 'q1', orderId: 'o1' } });
    const r = await svc.enqueueOrder('o1');
    expect(r.created).toBe(false);
    expect(r.entry).toMatchObject({ id: 'q1' });
    expect(create).not.toHaveBeenCalled();
  });

  it('loses the partial-unique race gracefully (P2002 → return winner)', async () => {
    const { svc } = makeService({ createThrowsP2002: true });
    // findFirst: 1st call (pre-create) null, 2nd call (post-P2002) the winner
    const ff = jest
      .fn<Promise<AnyArgs | null>, [AnyArgs]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'q-winner', orderId: 'o1' });
    (
      svc as unknown as { prisma: { client: { callQueueEntry: { findFirst: unknown } } } }
    ).prisma.client.callQueueEntry.findFirst = ff;
    const r = await svc.enqueueOrder('o1');
    expect(r.created).toBe(false);
    expect(r.entry).toMatchObject({ id: 'q-winner' });
  });

  it('enqueueAgain creates with the supplied availableAt', async () => {
    const { svc, create } = makeService({ open: null });
    const when = new Date('2026-05-20T10:00:00Z');
    await svc.enqueueAgain('o1', when);
    expect((create.mock.calls[0]![0].data as AnyArgs).availableAt).toEqual(when);
  });
});

describe('CallQueueService.dequeueOrder', () => {
  it('no-ops when no OPEN entry exists (idempotent)', async () => {
    const { svc, updateMany } = makeService({ openMany: [] });
    const r = await svc.dequeueOrder('o1', QueueClosureReason.ORDER_CONFIRMED);
    expect(r).toEqual({ dequeued: 0, preemptedAssigned: false });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('closes OPEN entries → COMPLETED + closureReason', async () => {
    const { svc, updateMany } = makeService({
      openMany: [{ id: 'q1', status: CallQueueStatus.PENDING, assignedAgentId: null }],
    });
    const r = await svc.dequeueOrder('o1', QueueClosureReason.ORDER_CONFIRMED);
    expect(r.dequeued).toBe(1);
    expect(r.preemptedAssigned).toBe(false);
    const data = updateMany.mock.calls[0]![0].data as AnyArgs;
    expect(data).toMatchObject({
      status: CallQueueStatus.COMPLETED,
      closureReason: QueueClosureReason.ORDER_CONFIRMED,
    });
  });

  it('audits when an ASSIGNED entry is preempted', async () => {
    const { svc, audit } = makeService({
      openMany: [{ id: 'q1', status: CallQueueStatus.ASSIGNED, assignedAgentId: 'agent-1' }],
    });
    const r = await svc.dequeueOrder('o1', QueueClosureReason.ADMIN_CLOSED);
    expect(r.preemptedAssigned).toBe(true);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log.mock.calls[0]![0]).toMatchObject({
      action: 'call_queue.assigned_entry_preempted',
      severity: 'MEDIUM',
    });
  });
});
