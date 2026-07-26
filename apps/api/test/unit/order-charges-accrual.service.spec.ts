import { ChargeType, Prisma, WalletEntryDirection } from '@skydrop/db';
import { OrderChargesAccrualService } from '../../src/modules/seller-wallet-accrual/services/order-charges-accrual.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    existingEntry?: AnyArgs | null;
    charges?: AnyArgs[];
  } = {},
) {
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.existingEntry === undefined ? null : opts.existingEntry),
  );
  const orderChargeFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.charges ?? [],
  );
  const applyEntry = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => ({
    id: 'entry-1',
    runningBalanceAfter: new Prisma.Decimal(0),
  }));
  const wallet = { applyEntry };
  const tx = {
    sellerWalletEntry: { findFirst },
    orderCharge: { findMany: orderChargeFindMany },
  };
  const svc = new OrderChargesAccrualService(wallet as unknown as WalletService);
  return { svc, tx, findFirst, orderChargeFindMany, applyEntry };
}

describe('OrderChargesAccrualService.debitIfNeeded', () => {
  it('sums non-refund charges and debits ORDER_CHARGES', async () => {
    const { svc, tx, applyEntry } = makeService({
      charges: [
        { type: ChargeType.BASE_SHIPPING, amountInr: new Prisma.Decimal('80') },
        { type: ChargeType.FUEL_SURCHARGE, amountInr: new Prisma.Decimal('10') },
        { type: ChargeType.GST, amountInr: new Prisma.Decimal('16.2') },
        { type: ChargeType.REFUND, amountInr: new Prisma.Decimal('50') },
      ],
    });
    const result = await svc.debitIfNeeded(tx as unknown as Prisma.TransactionClient, 'order-1', 'seller-1');
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
    const result = await svc.debitIfNeeded(tx as unknown as Prisma.TransactionClient, 'order-1', 'seller-1');
    expect(result).toBe(false);
    expect(applyEntry).not.toHaveBeenCalled();
    expect(orderChargeFindMany).not.toHaveBeenCalled();
  });

  it('no-ops (no debit) when total charges are zero', async () => {
    const { svc, tx, applyEntry } = makeService({ charges: [] });
    const result = await svc.debitIfNeeded(tx as unknown as Prisma.TransactionClient, 'order-1', 'seller-1');
    expect(result).toBe(false);
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('no-ops when the only charge is a REFUND (net <= 0)', async () => {
    const { svc, tx, applyEntry } = makeService({
      charges: [{ type: ChargeType.REFUND, amountInr: new Prisma.Decimal('50') }],
    });
    const result = await svc.debitIfNeeded(tx as unknown as Prisma.TransactionClient, 'order-1', 'seller-1');
    expect(result).toBe(false);
    expect(applyEntry).not.toHaveBeenCalled();
  });
});
