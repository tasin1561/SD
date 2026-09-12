import { Prisma, WalletEntryDirection } from '@skydrop/db';
import { EndedOrderMoneyService } from '../../src/modules/seller-wallet-accrual/services/ended-order-money.service';

type AnyArgs = Record<string, unknown>;

/**
 * What an order ENDING undelivered gives back, beyond the delivery fee:
 * the deferred (T+N) accrual is retired, and an Instant Pay credit that no
 * courier ever paid for is taken back — with the cash the front made the
 * seller's becoming ours again.
 */
function make(
  opts: {
    /** Payout lines already recorded for the order. */
    paid?: number;
    /** The seller's wallet before the reversal. */
    before?: string;
    reverse?: { reversed: boolean; reason?: string; grossInr?: string; returnedInr?: string };
  } = {},
) {
  const updateMany = jest.fn(async (_a: AnyArgs) => ({ count: 1 }));
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    courierSettlementLine: { count: jest.fn(async () => opts.paid ?? 0) },
    sellerWalletEntry: { findFirst: jest.fn(async () => ({ id: 'we-reversal' })) },
  };
  const client = {
    pendingAccrual: { updateMany },
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
  const reverseForOrder = jest.fn(async () => ({
    reversed: true,
    grossInr: '1000.00',
    returnedInr: '180.00',
    ...(opts.reverse ?? {}),
  }));
  const takeToCapital = jest.fn(async (_t: unknown, _i: AnyArgs) => new Prisma.Decimal(0));
  const walletBalance = jest.fn(async () => new Prisma.Decimal(opts.before ?? '1000'));
  const recompute = jest.fn(async () => undefined);
  const audit = jest.fn(async () => 'a1');
  const svc = new EndedOrderMoneyService(
    { client } as never,
    { recomputeCacheAfterCommit: recompute } as never,
    { reverseForOrder } as never,
    { walletBalance, takeToCapital } as never,
    { log: audit } as never,
  );
  return { svc, updateMany, reverseForOrder, takeToCapital, recompute, audit, tx };
}

describe('EndedOrderMoneyService.retirePendingAccrual', () => {
  it('closes only an UNPROCESSED row, with its reason — never one that already billed', async () => {
    const { svc, updateMany } = make();
    await expect(svc.retirePendingAccrual('o1', 'ORDER_CANCELLED_BY_ADMIN')).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', processedAt: null },
      data: { processedAt: expect.any(Date), skippedReason: 'ORDER_CANCELLED_BY_ADMIN' },
    });
  });
});

describe('EndedOrderMoneyService.reverseUncoveredInstantPayCredit', () => {
  it('takes the credit back and makes the fronted cash ours again — max(0,before) − max(0,before−gross)', async () => {
    // Held ₹1,000 before; reversing a ₹1,000 credit leaves them ₹0 of it.
    const { svc, reverseForOrder, takeToCapital, recompute } = make({ before: '1000' });
    const r = await svc.reverseUncoveredInstantPayCredit('o1', 's1', 'called off');
    expect(r).toEqual({ reversed: true });
    expect(reverseForOrder).toHaveBeenCalledWith(expect.anything(), {
      orderId: 'o1',
      sellerId: 's1',
      note: 'called off',
    });
    const call = takeToCapital.mock.calls[0]![1];
    expect((call.amount as Prisma.Decimal).toString()).toBe('1000');
    // Referenced by the reversal entry, never by the order id — the front
    // is the ONLY pair referenced by an order id (WAL-9).
    expect(call.reference).toBe('we-reversal');
    expect(recompute).toHaveBeenCalled();
  });

  it('a seller already in debt holds nothing of it — nothing is moved', async () => {
    const { svc, takeToCapital } = make({ before: '-50' });
    await svc.reverseUncoveredInstantPayCredit('o1', 's1', 'called off');
    expect(takeToCapital).not.toHaveBeenCalled();
  });

  it('takes only what they hold when it is less than the credit', async () => {
    const { svc, takeToCapital } = make({ before: '400' });
    await svc.reverseUncoveredInstantPayCredit('o1', 's1', 'called off');
    expect((takeToCapital.mock.calls[0]![1].amount as Prisma.Decimal).toString()).toBe('400');
  });

  it('leaves it to the settlement once a courier payout covers the order (WAL-6)', async () => {
    const { svc, reverseForOrder, takeToCapital } = make({ paid: 1 });
    await expect(svc.reverseUncoveredInstantPayCredit('o1', 's1', 'x')).resolves.toEqual({
      reversed: false,
      reason: 'COURIER_PAYOUT_RECORDED',
    });
    expect(reverseForOrder).not.toHaveBeenCalled();
    expect(takeToCapital).not.toHaveBeenCalled();
  });

  it('is a no-op on an order never credited (the ordinary SETTLEMENT case)', async () => {
    const { svc, takeToCapital, recompute } = make({
      reverse: { reversed: false, reason: 'NEVER_CREDITED' },
    });
    await expect(svc.reverseUncoveredInstantPayCredit('o1', 's1', 'x')).resolves.toEqual({
      reversed: false,
      reason: 'NEVER_CREDITED',
    });
    expect(takeToCapital).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });

  it('reads the reversal it just wrote as the pair reference', async () => {
    const { svc, tx } = make();
    await svc.reverseUncoveredInstantPayCredit('o1', 's1', 'x');
    expect(tx.sellerWalletEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { linkedOrderId: 'o1', direction: WalletEntryDirection.COD_REVERSAL },
      }),
    );
  });
});
