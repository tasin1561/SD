import { OrderChargesService } from '../../src/modules/order-charges/services/order-charges.service';

type AnyArgs = Record<string, unknown>;

function makeService(orders: Array<{ id: string; orderNumber: string; status: string }>) {
  const findMany = jest.fn<Promise<typeof orders>, [AnyArgs]>(async () => orders);
  const svc = Object.create(OrderChargesService.prototype) as OrderChargesService;
  Object.assign(svc, {
    prisma: { client: { order: { findMany } } },
  });
  const persist = jest.fn(async () => ({ chargeCount: 2 }));
  (svc as unknown as AnyArgs)['persistForOrderSystem'] = persist;
  return { svc, findMany, persist };
}

const ORDERS = [
  { id: 'o1', orderNumber: 'SD-1', status: 'IN_TRANSIT' },
  { id: 'o2', orderNumber: 'SD-2', status: 'DELIVERED' },
];

/**
 * An order with no charge rows is billed NOTHING when it delivers —
 * `debitIfNeeded` sums zero and returns false, so the parcel ships and
 * the seller is never invoiced. This finds those orders.
 */
describe('OrderChargesService.backfillMissing', () => {
  it('selects only orders with NO live charge rows', async () => {
    const { svc, findMany } = makeService(ORDERS);
    await svc.backfillMissing({ dryRun: true, limit: 100 });

    const where = (findMany.mock.calls[0]?.[0] as AnyArgs).where as AnyArgs;
    // A soft-deleted charge must not count as "has charges", or an
    // order whose charges were voided stays invisible and unbilled.
    expect(where['charges']).toEqual({ none: { deletedAt: null } });
    expect(where['deletedAt']).toBeNull();
  });

  it('a dry run writes NOTHING', async () => {
    const { svc, persist } = makeService(ORDERS);
    const r = await svc.backfillMissing({ dryRun: true, limit: 100 });

    expect(persist).not.toHaveBeenCalled();
    expect(r.examined).toBe(2);
    expect(r.persisted).toBe(0);
    expect(r.orders.every((o) => o.outcome === 'WOULD_ADD')).toBe(true);
  });

  it('prices every candidate on a real run, delivered or not', async () => {
    const { svc, persist } = makeService(ORDERS);
    const r = await svc.backfillMissing({ dryRun: false, limit: 100 });

    // Undelivered orders included on purpose: their charges are not
    // money yet, and having them in place means the fee is there when
    // delivery comes rather than depending on this running again.
    expect(persist).toHaveBeenCalledTimes(2);
    expect(r.persisted).toBe(2);
  });

  it('one order failing does not abandon the rest', async () => {
    const { svc, persist } = makeService(ORDERS);
    (persist as jest.Mock).mockRejectedValueOnce(new Error('no rate card'));

    const r = await svc.backfillMissing({ dryRun: false, limit: 100 });

    expect(r.failed).toBe(1);
    expect(r.persisted).toBe(1);
    // The failure is NAMED, so an operator knows which order to look at.
    expect(r.orders.find((o) => o.outcome === 'no rate card')).toBeDefined();
  });
});
