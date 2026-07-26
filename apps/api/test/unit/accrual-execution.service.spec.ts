import { Currency, PaymentMode, Prisma, WalletEntryDirection } from '@skydrop/db';
import { AccrualExecutionService } from '../../src/modules/seller-wallet-accrual/services/accrual-execution.service';
import { OrderChargesAccrualService } from '../../src/modules/seller-wallet-accrual/services/order-charges-accrual.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { InboundFreightAmortisationService } from '../../src/modules/inbound-freight/services/inbound-freight-amortisation.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    codEntryExists?: boolean;
    order?: AnyArgs | null;
    charges?: AnyArgs[];
    chargesEntryExists?: boolean;
  } = {},
) {
  const walletEntryFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async (args) => {
      const direction = (args.where as { direction: WalletEntryDirection }).direction;
      if (direction === WalletEntryDirection.COD_COLLECTION) {
        return opts.codEntryExists ? { id: 'cod-existing' } : null;
      }
      if (direction === WalletEntryDirection.ORDER_CHARGES) {
        return opts.chargesEntryExists ? { id: 'charges-existing' } : null;
      }
      return null;
    },
  );
  const orderChargeFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.charges ?? [],
  );
  const orderFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.order === undefined
      ? {
          id: 'order-1',
          sellerId: 'seller-1',
          paymentMode: PaymentMode.COD,
          codAmountInr: new Prisma.Decimal('500'),
        }
      : opts.order,
  );

  const tx = {
    sellerWalletEntry: { findFirst: walletEntryFindFirst },
    orderCharge: { findMany: orderChargeFindMany },
  };
  const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
  const client = {
    order: { findUnique: orderFindUnique },
    sellerWalletEntry: { findFirst: walletEntryFindFirst },
    $transaction,
  };
  const prisma = { client } as unknown as PrismaService;

  const applyEntry = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => ({
    id: 'entry-new',
    runningBalanceAfter: new Prisma.Decimal(0),
  }));
  const recomputeCacheAfterCommit = jest.fn(async () => undefined);
  const wallet = { applyEntry, recomputeCacheAfterCommit };

  const chargesAccrual = new OrderChargesAccrualService(wallet as unknown as WalletService);

  // R3 amortisation: these fixtures cover orders whose goods came from no
  // billed consignment, so the freight hook is a no-op (0 debited).
  const debitForDeliveredOrder = jest.fn(async () => ({
    amountInr: '0',
    unitsCharged: 0,
    alreadyCharged: false,
  }));
  const freightAmortisation = {
    debitForDeliveredOrder,
  } as unknown as InboundFreightAmortisationService;

  const svc = new AccrualExecutionService(
    prisma,
    wallet as unknown as WalletService,
    chargesAccrual,
    freightAmortisation,
  );
  return {
    svc,
    applyEntry,
    recomputeCacheAfterCommit,
    orderFindUnique,
    orderChargeFindMany,
    walletEntryFindFirst,
    debitForDeliveredOrder,
  };
}

describe('AccrualExecutionService.executeAccrual', () => {
  it('COD order, nothing debited yet: credits COD + debits charges in one tx', async () => {
    const { svc, applyEntry, recomputeCacheAfterCommit } = makeService({
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await svc.executeAccrual('order-1');
    expect(applyEntry).toHaveBeenCalledTimes(2);
    const directions = applyEntry.mock.calls.map((c) => (c[1] as AnyArgs).direction);
    expect(directions).toEqual(
      expect.arrayContaining([WalletEntryDirection.COD_COLLECTION, WalletEntryDirection.ORDER_CHARGES]),
    );
    expect(recomputeCacheAfterCommit).toHaveBeenCalledWith('seller-1', Currency.INR, 'post-commit-accrual');
  });

  it('R1c: charges already debited early (AT_AWB) — still credits COD, does NOT re-debit charges', async () => {
    const { svc, applyEntry } = makeService({
      chargesEntryExists: true,
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await svc.executeAccrual('order-1');
    expect(applyEntry).toHaveBeenCalledTimes(1);
    expect((applyEntry.mock.calls[0]![1] as AnyArgs).direction).toBe(WalletEntryDirection.COD_COLLECTION);
  });

  it('fully processed already (both entries exist): no writes at all, still succeeds', async () => {
    const { svc, applyEntry } = makeService({ codEntryExists: true, chargesEntryExists: true });
    await svc.executeAccrual('order-1');
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('PREPAID order: no COD credit, charges still debited', async () => {
    const { svc, applyEntry } = makeService({
      order: {
        id: 'order-1',
        sellerId: 'seller-1',
        paymentMode: PaymentMode.PREPAID,
        codAmountInr: null,
      },
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await svc.executeAccrual('order-1');
    expect(applyEntry).toHaveBeenCalledTimes(1);
    expect((applyEntry.mock.calls[0]![1] as AnyArgs).direction).toBe(WalletEntryDirection.ORDER_CHARGES);
  });

  it('order vanished before execution: logs + returns, no writes, no throw', async () => {
    const { svc, applyEntry } = makeService({ order: null });
    await expect(svc.executeAccrual('order-1')).resolves.toBeUndefined();
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('zero COD amount: no COD credit written even though paymentMode is COD', async () => {
    const { svc, applyEntry } = makeService({
      order: { id: 'order-1', sellerId: 'seller-1', paymentMode: PaymentMode.COD, codAmountInr: new Prisma.Decimal('0') },
    });
    await svc.executeAccrual('order-1');
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('is idempotent: calling it twice in a row does not double-write', async () => {
    let codWritten = false;
    let chargesWritten = false;
    const walletEntryFindFirst = jest.fn(async (args: AnyArgs) => {
      const direction = (args.where as { direction: WalletEntryDirection }).direction;
      if (direction === WalletEntryDirection.COD_COLLECTION) return codWritten ? { id: 'x' } : null;
      if (direction === WalletEntryDirection.ORDER_CHARGES) return chargesWritten ? { id: 'y' } : null;
      return null;
    });
    const orderChargeFindMany = jest.fn(async () => [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }]);
    const orderFindUnique = jest.fn(async () => ({
      id: 'order-1',
      sellerId: 'seller-1',
      paymentMode: PaymentMode.COD,
      codAmountInr: new Prisma.Decimal('500'),
    }));
    const tx = { sellerWalletEntry: { findFirst: walletEntryFindFirst }, orderCharge: { findMany: orderChargeFindMany } };
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    const client = { order: { findUnique: orderFindUnique }, sellerWalletEntry: { findFirst: walletEntryFindFirst }, $transaction };
    const prisma = { client } as unknown as PrismaService;
    const applyEntry = jest.fn(async (_tx: unknown, input: AnyArgs) => {
      if (input.direction === WalletEntryDirection.COD_COLLECTION) codWritten = true;
      if (input.direction === WalletEntryDirection.ORDER_CHARGES) chargesWritten = true;
      return { id: 'e', runningBalanceAfter: new Prisma.Decimal(0) };
    });
    const recomputeCacheAfterCommit = jest.fn(async () => undefined);
    const wallet = { applyEntry, recomputeCacheAfterCommit };
    const chargesAccrual = new OrderChargesAccrualService(wallet as unknown as WalletService);
    const freightAmortisation = {
      debitForDeliveredOrder: jest.fn(async () => ({
        amountInr: '0',
        unitsCharged: 0,
        alreadyCharged: false,
      })),
    } as unknown as InboundFreightAmortisationService;
    const svc = new AccrualExecutionService(
      prisma,
      wallet as unknown as WalletService,
      chargesAccrual,
      freightAmortisation,
    );

    await svc.executeAccrual('order-1');
    await svc.executeAccrual('order-1');
    expect(applyEntry).toHaveBeenCalledTimes(2); // one COD + one ORDER_CHARGES, never twice each
  });
});
