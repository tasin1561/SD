import { ChargeType, Prisma, WalletEntryDirection } from '@skydrop/db';
import { OrderChargesAccrualService } from '../../src/modules/seller-wallet-accrual/services/order-charges-accrual.service';

/** WAL-7's advisory lock, as the fake sees it. */
const lockTaken = jest.fn(async () => 1);
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    existingEntry?: AnyArgs | null;
    /** A charge that was taken and then REFUNDED (a lost parcel). */
    refunded?: boolean;
    charges?: AnyArgs[];
  } = {},
) {
  // Charges and refunds pair up: billed means more charges than refunds.
  const count = jest.fn<Promise<number>, [AnyArgs]>(async (a) => {
    const direction = (a.where as { direction: WalletEntryDirection }).direction;
    if (direction === WalletEntryDirection.ORDER_CHARGES) {
      return opts.existingEntry ? 1 : 0;
    }
    return opts.refunded ? 1 : 0;
  });
  const findFirst = count;
  const orderChargeFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.charges ?? [],
  );
  const applyEntry = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => ({
    id: 'entry-1',
    runningBalanceAfter: new Prisma.Decimal(0),
  }));
  const wallet = { applyEntry };
  const tx = {
    // The wallet advisory lock (WAL-7). Recorded rather than stubbed
    // away: a guard that reads the ledger before writing must serialise
    // against a concurrent one, and a fake with no $executeRaw would let
    // an unlocked version pass this suite.
    $executeRaw: lockTaken,
    sellerWalletEntry: { count },
    orderCharge: { findMany: orderChargeFindMany },
  };
  const svc = new OrderChargesAccrualService(wallet as unknown as WalletService);
  return { svc, tx, findFirst, orderChargeFindMany, applyEntry };
}

describe('OrderChargesAccrualService.debitIfNeeded', () => {
  it('bills AGAIN when the earlier charge was refunded — lost, then found and delivered', async () => {
    // Charges and refunds pair up. A plain "a charge exists" gate left a
    // found parcel refunded AND unbilled.
    const { svc, tx, applyEntry } = makeService({
      existingEntry: { id: 'e' },
      refunded: true,
      charges: [
        {
          id: 'c-base',
          type: ChargeType.BASE_SHIPPING,
          amountInr: new Prisma.Decimal('200'),
          status: 'CONFIRMED',
        },
      ],
    });
    (tx as unknown as { orderCharge: { updateMany?: unknown } }).orderCharge.updateMany = jest.fn(
      async () => ({ count: 0 }),
    );
    await expect(svc.debitIfNeeded(tx as never, 'o1', 's1')).resolves.toBe(true);
    expect(applyEntry).toHaveBeenCalledTimes(1);
  });

  it('confirms exactly the ESTIMATED lines it billed, in the same transaction', async () => {
    const { svc, tx, applyEntry } = makeService({
      charges: [
        {
          id: 'c-base',
          type: ChargeType.BASE_SHIPPING,
          amountInr: new Prisma.Decimal('200'),
          status: 'ESTIMATED',
        },
        {
          id: 'c-gst',
          type: ChargeType.GST,
          amountInr: new Prisma.Decimal('0'),
          status: 'ESTIMATED',
        },
        // Already CONFIRMED / not part of this debit: left alone.
        {
          id: 'c-rto',
          type: ChargeType.RTO_FEE,
          amountInr: new Prisma.Decimal('30'),
          status: 'CONFIRMED',
        },
        {
          id: 'c-refund',
          type: ChargeType.REFUND,
          amountInr: new Prisma.Decimal('50'),
          status: 'ESTIMATED',
        },
      ],
    });
    const updateMany = jest.fn(async () => ({ count: 2 }));
    (tx.orderCharge as AnyArgs).updateMany = updateMany;

    await svc.debitIfNeeded(tx as unknown as Prisma.TransactionClient, 'order-1', 'seller-1');

    expect(applyEntry).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c-base', 'c-gst'] }, status: 'ESTIMATED' },
      data: { status: 'CONFIRMED' },
    });
    // The amount is untouched by the status change.
    const amount = (applyEntry.mock.calls[0]![1] as AnyArgs).amount as Prisma.Decimal;
    expect(amount.toString()).toBe('200');
  });

  it('confirms nothing when nothing was billed (already debited)', async () => {
    const { svc, tx } = makeService({ existingEntry: { id: 'e' } });
    const updateMany = jest.fn(async () => ({ count: 0 }));
    (tx.orderCharge as AnyArgs).updateMany = updateMany;
    await svc.debitIfNeeded(tx as unknown as Prisma.TransactionClient, 'order-1', 'seller-1');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('sums non-refund charges and debits ORDER_CHARGES', async () => {
    const { svc, tx, applyEntry } = makeService({
      charges: [
        { type: ChargeType.BASE_SHIPPING, amountInr: new Prisma.Decimal('80') },
        { type: ChargeType.FUEL_SURCHARGE, amountInr: new Prisma.Decimal('10') },
        { type: ChargeType.GST, amountInr: new Prisma.Decimal('16.2') },
        { type: ChargeType.REFUND, amountInr: new Prisma.Decimal('50') },
      ],
    });
    const result = await svc.debitIfNeeded(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'seller-1',
    );
    expect(result).toBe(true);
    expect(applyEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sellerId: 'seller-1',
        direction: WalletEntryDirection.ORDER_CHARGES,
        linkedOrderId: 'order-1',
      }),
    );
    const amount = (applyEntry.mock.calls[0]![1] as AnyArgs).amount as Prisma.Decimal;
    // 80 + 10 + 16.2 = 106.2 — REFUND excluded.
    expect(amount.toString()).toBe('106.2');
  });

  it('is idempotent: a pre-existing ORDER_CHARGES entry short-circuits, no re-debit', async () => {
    const { svc, tx, applyEntry, orderChargeFindMany } = makeService({
      existingEntry: { id: 'already-1' },
    });
    const result = await svc.debitIfNeeded(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'seller-1',
    );
    expect(result).toBe(false);
    expect(applyEntry).not.toHaveBeenCalled();
    expect(orderChargeFindMany).not.toHaveBeenCalled();
  });

  it('no-ops (no debit) when total charges are zero', async () => {
    const { svc, tx, applyEntry } = makeService({ charges: [] });
    const result = await svc.debitIfNeeded(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'seller-1',
    );
    expect(result).toBe(false);
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('no-ops when the only charge is a REFUND (net <= 0)', async () => {
    const { svc, tx, applyEntry } = makeService({
      charges: [{ type: ChargeType.REFUND, amountInr: new Prisma.Decimal('50') }],
    });
    const result = await svc.debitIfNeeded(
      tx as unknown as Prisma.TransactionClient,
      'order-1',
      'seller-1',
    );
    expect(result).toBe(false);
    expect(applyEntry).not.toHaveBeenCalled();
  });
});
