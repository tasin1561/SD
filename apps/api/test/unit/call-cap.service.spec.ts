import { ReattemptRequestStatus } from '@skydrop/db';
import { CallCapService } from '../../src/modules/call-center/services/call-cap.service';

/**
 * How many calls an order gets before it is out of chances.
 *
 * One service owns the formula because two consumers need the same
 * number and they fail differently when it drifts: the attempt service
 * ENFORCES it, the queue screen DISPLAYS it. A screen reading 3/3 beside
 * an order the server will happily call twice more is a number people
 * quietly stop trusting.
 */
describe('CallCapService', () => {
  function make(grants: Array<{ orderId: string; sum: number }>, base = 3) {
    const aggregate = jest.fn().mockResolvedValue({
      _sum: { extraAttempts: grants[0]?.sum ?? null },
    });
    const groupBy = jest
      .fn()
      .mockResolvedValue(
        grants.map((g) => ({ orderId: g.orderId, _sum: { extraAttempts: g.sum } })),
      );
    const prisma = {
      client: {
        seller: {
          findUnique: jest.fn().mockResolvedValue({ callMaxAttemptsBeforeNdrOverride: null }),
        },
        orderReattemptRequest: { aggregate, groupBy },
      },
    } as never;
    const settings = { resolveIntWithLegacy: jest.fn(async () => base) } as never;
    return { svc: new CallCapService(prisma, settings), aggregate, groupBy };
  }

  it('adds granted headroom to the seller cap', async () => {
    const { svc } = make([{ orderId: 'o1', sum: 2 }]);
    expect(await svc.effectiveForOrder('s1', 'o1')).toBe(5);
  });

  it('is just the seller cap when nothing was granted', async () => {
    const { svc } = make([]);
    expect(await svc.effectiveForOrder('s1', 'o1')).toBe(3);
  });

  it('counts APPROVED grants only', async () => {
    const { svc, aggregate } = make([{ orderId: 'o1', sum: 1 }]);
    await svc.grantedExtra('o1');
    // A pending plea must not raise the cap before anybody agreed to it.
    expect(aggregate.mock.calls[0]?.[0].where.status).toBe(ReattemptRequestStatus.APPROVED);
  });

  it('sums across approvals rather than taking the latest', async () => {
    // An order argued for twice was granted twice, and each grant was a
    // decision somebody made.
    const { svc, groupBy } = make([{ orderId: 'o1', sum: 4 }]);
    const map = await svc.grantedExtraByOrder(['o1']);
    expect(map.get('o1')).toBe(4);
    expect(groupBy.mock.calls[0]?.[0]._sum).toEqual({ extraAttempts: true });
  });

  it('asks nothing for an empty page', async () => {
    const { svc, groupBy } = make([]);
    expect((await svc.grantedExtraByOrder([])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
