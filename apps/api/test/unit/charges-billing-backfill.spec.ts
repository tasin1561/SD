import { ChargesBillingBackfillService } from '../../src/modules/seller-wallet-accrual/services/charges-billing-backfill.service';

type AnyArgs = Record<string, unknown>;

type Candidate = { id: string; orderNumber: string; status: string; sellerId: string };

function makeService(candidates: Candidate[]) {
  const findMany = jest.fn<Promise<Candidate[]>, [AnyArgs]>(async () => candidates);
  const debitIfNeeded = jest.fn(async () => true);
  const persistForOrderSystem = jest.fn(async () => ({ chargeCount: 2 }));
  const svc = Object.create(
    ChargesBillingBackfillService.prototype,
  ) as ChargesBillingBackfillService;
  Object.assign(svc, {
    prisma: {
      client: {
        order: { findMany },
        // The report's total is re-read from the WALLET rather than
        // summed as we go — the money moved is the ledger's number, not
        // the loop's.
        sellerWalletEntry: {
          aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
        },
        $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      },
    },
    charges: { persistForOrderSystem },
    accrual: { debitIfNeeded },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return { svc, findMany, debitIfNeeded, persistForOrderSystem };
}

const CANDIDATES: Candidate[] = [
  { id: 'o1', orderNumber: 'SD-1', status: 'DELIVERED', sellerId: 's1' },
  { id: 'o2', orderNumber: 'SD-2', status: 'RTO_RESTOCKED', sellerId: 's1' },
];

describe('ChargesBillingBackfillService.run', () => {
  it('leaves scheduled accruals alone — not-yet-due is not unbilled', async () => {
    const { svc, findMany } = makeService(CANDIDATES);
    await svc.run({ dryRun: true, limit: 100 });
    const where = (findMany.mock.calls[0]?.[0] as AnyArgs).where as AnyArgs;

    // On the default T_PLUS_N tier a delivered order's charges are taken
    // `wallet.accrual_delay_days` later and it carries an unprocessed
    // pending_accruals row until then. Billing it now would look
    // perfectly correct — right amount, genuinely owed — while silently
    // overriding the accrual tier the business chose, for every seller
    // at once.
    expect(where['OR']).toEqual([
      { pendingAccrual: { is: null } },
      { pendingAccrual: { processedAt: { not: null } } },
    ]);
  });

  it('an ALREADY-PROCESSED accrual does not exclude the order — that is the real miss', async () => {
    const { svc, findMany } = makeService(CANDIDATES);
    await svc.run({ dryRun: true, limit: 100 });
    const where = (findMany.mock.calls[0]?.[0] as AnyArgs).where as AnyArgs;
    const or = where['OR'] as Array<AnyArgs>;
    // The sweep ran and still no money moved: that is what this exists for.
    expect(or).toContainEqual({ pendingAccrual: { processedAt: { not: null } } });
  });

  it('bills only orders whose journey ENDED, and only unbilled ones', async () => {
    const { svc, findMany } = makeService(CANDIDATES);
    await svc.run({ dryRun: true, limit: 100 });
    const where = (findMany.mock.calls[0]?.[0] as AnyArgs).where as AnyArgs;
    // In-transit would charge for a service still running, and would
    // double-charge when the delivery accrual runs.
    expect(where['status']).toEqual({ in: ['DELIVERED', 'RTO_RESTOCKED'] });
    expect(where['walletEntries']).toEqual({ none: { direction: 'ORDER_CHARGES' } });
    expect(where['deletedAt']).toBeNull();
  });

  it('a dry run moves no money', async () => {
    const { svc, debitIfNeeded, persistForOrderSystem } = makeService(CANDIDATES);
    const report = await svc.run({ dryRun: true, limit: 100 });
    expect(debitIfNeeded).not.toHaveBeenCalled();
    expect(persistForOrderSystem).not.toHaveBeenCalled();
    expect(report.billed).toBe(0);
    expect(report.examined).toBe(2);
  });

  it('prices before billing — an order with no rows sums to zero and bills nothing', async () => {
    const { svc, persistForOrderSystem, debitIfNeeded } = makeService(CANDIDATES);
    await svc.run({ dryRun: false, limit: 100 });
    // Charges must exist before the money is taken, or the run reports
    // success having billed nobody.
    expect(persistForOrderSystem).toHaveBeenCalledTimes(2);
    expect(debitIfNeeded).toHaveBeenCalledTimes(2);
  });

  it('one order failing does not abandon the rest', async () => {
    const { svc, debitIfNeeded } = makeService(CANDIDATES);
    debitIfNeeded.mockRejectedValueOnce(new Error('wallet locked'));
    const report = await svc.run({ dryRun: false, limit: 100 });
    expect(report.failed).toBe(1);
    expect(report.billed).toBe(1);
    expect(report.orders).toHaveLength(2);
  });
});
