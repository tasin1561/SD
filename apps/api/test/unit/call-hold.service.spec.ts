import { CallHoldOutcome } from '@skydrop/db';
import { CallHoldService } from '../../src/modules/call-center/services/call-hold.service';

/**
 * The evaluation record: who held a call, for how long, and what came
 * of it.
 *
 * A hold OPENS in the same transaction as the pull and closes exactly
 * once. These pin the properties that make the data trustworthy — the
 * first close wins (so a retry cannot overwrite what really happened),
 * the duration is computed from the hold's own start, and a failure here
 * never propagates, because losing a statistic must not roll back a
 * customer's call outcome.
 */
describe('CallHoldService.close', () => {
  function make(open: { id: string; startedAt: Date } | null) {
    const findFirst = jest.fn().mockResolvedValue(open);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      client: { callAssignmentHold: { findFirst, updateMany, findMany: jest.fn() } },
    } as never;
    return { svc: new CallHoldService(prisma), findFirst, updateMany };
  }

  it('records the duration from the hold’s own start', async () => {
    const startedAt = new Date('2026-08-20T10:00:00Z');
    const endedAt = new Date('2026-08-20T10:07:30Z');
    const { svc, updateMany } = make({ id: 'h1', startedAt });

    await svc.close('q1', CallHoldOutcome.EXPIRED, { endedAt });

    const data = updateMany.mock.calls[0]?.[0].data;
    expect(data.heldSeconds).toBe(450); // 7m30s
    expect(data.outcome).toBe(CallHoldOutcome.EXPIRED);
    expect(data.endedAt).toBe(endedAt);
  });

  it('only closes a hold that is still open — first close wins', async () => {
    const { svc, updateMany } = make({ id: 'h1', startedAt: new Date() });
    await svc.close('q1', CallHoldOutcome.COMPLETED, { attemptId: 'a1' });
    // The guard is what stops a retry, or two paths racing, from
    // rewriting an outcome that already happened.
    expect(updateMany.mock.calls[0]?.[0].where).toEqual({ id: 'h1', endedAt: null });
  });

  it('carries the attempt id, which is what separates worked from dropped', async () => {
    const { svc, updateMany } = make({ id: 'h1', startedAt: new Date() });
    await svc.close('q1', CallHoldOutcome.COMPLETED, { attemptId: 'att-9' });
    expect(updateMany.mock.calls[0]?.[0].data.attemptId).toBe('att-9');

    const dropped = make({ id: 'h2', startedAt: new Date() });
    await dropped.svc.close('q2', CallHoldOutcome.RELEASED);
    expect(dropped.updateMany.mock.calls[0]?.[0].data.attemptId).toBeNull();
  });

  it('no-ops when there is no open hold', async () => {
    const { svc, updateMany } = make(null);
    await svc.close('q1', CallHoldOutcome.EXPIRED);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('never throws — a lost statistic must not roll back a call outcome', async () => {
    const prisma = {
      client: {
        callAssignmentHold: {
          findFirst: jest.fn().mockRejectedValue(new Error('db down')),
          findMany: jest.fn(),
          updateMany: jest.fn(),
        },
      },
    } as never;
    await expect(
      new CallHoldService(prisma).close('q1', CallHoldOutcome.COMPLETED),
    ).resolves.toBeUndefined();
  });

  it('clamps a negative duration rather than recording one', async () => {
    // Clock skew between two servers is not a reason to store a hold
    // that ended before it began.
    const startedAt = new Date('2026-08-20T10:00:05Z');
    const endedAt = new Date('2026-08-20T10:00:00Z');
    const { svc, updateMany } = make({ id: 'h1', startedAt });
    await svc.close('q1', CallHoldOutcome.EXPIRED, { endedAt });
    expect(updateMany.mock.calls[0]?.[0].data.heldSeconds).toBe(0);
  });
});
