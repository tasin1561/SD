import { CallOutcome, CallQueueStatus } from '@skydrop/db';
import { AdminCallQueueService } from '../../src/modules/call-center/services/admin-call-queue.service';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';

/**
 * What the queue reports as "attempts".
 *
 * `scheduledAttempts` increments inside `pullNext` — the moment an agent
 * CLAIMS the row, before any call is made, and again on a re-pull after
 * an expiry. The admin queue showed it under a column headed "Attempts",
 * so an order nobody had phoned yet read as having been attempted once,
 * and an operator judging whether an order was near the NDR cap was
 * reading a number the cap is not computed from.
 *
 * The cap is judged on CC-5's 6-of-9 counting outcomes. These pin that
 * the row reports claims and conversations as separate numbers, and that
 * the counting subset is derived from the mapping service rather than a
 * second copy of the list (CC-2).
 */
describe('AdminCallQueueService — attempts vs pulls', () => {
  function make(attempts: Array<{ outcome: CallOutcome }>, scheduledAttempts: number) {
    // Grouped per order, mirroring the groupBy the service runs.
    const grouped = new Map<CallOutcome, number>();
    for (const a of attempts) grouped.set(a.outcome, (grouped.get(a.outcome) ?? 0) + 1);
    const attemptGroups = [...grouped].map(([outcome, n]) => ({
      orderId: 'o1',
      outcome,
      _count: { _all: n },
    }));
    const row = {
      id: 'q1',
      orderId: 'o1',
      status: CallQueueStatus.ASSIGNED,
      assignedAgentId: 'a1',
      assignedAt: new Date(),
      availableAt: new Date(),
      scheduledAttempts,
      maxAttempts: 3,
      createdAt: new Date(),
      order: { orderNumber: 'SD-1', sellerId: 's1', status: 'pending_confirmation' },
      assignedAgent: { id: 'a1', emailDisplay: 'agent@skydrop.online' },
    };
    const prisma = {
      client: {
        callQueueEntry: {
          findMany: jest.fn().mockResolvedValue([row]),
          count: jest.fn().mockResolvedValue(1),
        },
        callAttempt: { groupBy: jest.fn().mockResolvedValue(attemptGroups) },
      },
    } as never;
    const svc = new AdminCallQueueService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new CallOutcomeMappingService(),
      // Cap resolution lives in CallCapService; these tests are about
      // the queue's shape, not the number.
      {
        grantedExtraByOrder: jest.fn(async () => new Map()),
        baseForSeller: jest.fn(async () => 3),
      } as never,
    );
    return svc;
  }

  it('a claimed-but-never-called order reports ZERO calls, not one', async () => {
    const svc = make([], 1);
    const { items } = await svc.listQueue({ page: 1, pageSize: 20 } as never);
    const row = items[0];
    expect(row?.attemptsLogged).toBe(0);
    expect(row?.attemptsCounting).toBe(0);
    // The claim still shows, under its own name.
    expect(row?.scheduledAttempts).toBe(1);
  });

  it('counts only the outcomes the NDR cap is judged on', async () => {
    const svc = make(
      [
        { outcome: CallOutcome.NO_ANSWER }, // counts
        { outcome: CallOutcome.BUSY }, // counts
        { outcome: CallOutcome.TECHNICAL_FAILURE }, // does NOT
        { outcome: CallOutcome.LANGUAGE_BARRIER }, // does NOT
      ],
      2,
    );
    const { items } = await svc.listQueue({ page: 1, pageSize: 20 } as never);
    expect(items[0]?.attemptsLogged).toBe(4);
    expect(items[0]?.attemptsCounting).toBe(2);
  });

  it('counts per ORDER, so a re-queued entry does not read as a fresh start', async () => {
    // The retry lives on a NEW entry with zero attempts of its own
    // (locked decision #2). Counting per entry showed "0/3" for an order
    // already on its second attempt, which makes a working retry chain
    // look like it can loop forever. CC-5 counts by orderId; so does
    // this.
    const svc = make([{ outcome: CallOutcome.NO_ANSWER }], 0);
    const { items } = await svc.listQueue({ page: 1, pageSize: 20 } as never);
    // The entry itself has been pulled zero times and holds no attempts;
    // the ORDER has one against the cap.
    expect(items[0]?.scheduledAttempts).toBe(0);
    expect(items[0]?.attemptsCounting).toBe(1);
  });

  it('resolves the holding agent to a human identity, never a bare id', async () => {
    const svc = make([], 1);
    const { items } = await svc.listQueue({ page: 1, pageSize: 20 } as never);
    expect(items[0]?.agent).toEqual({ id: 'a1', name: 'agent@skydrop.online' });
  });
});
