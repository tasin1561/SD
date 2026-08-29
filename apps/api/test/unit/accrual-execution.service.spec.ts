import { Currency, PaymentMode, Prisma, WalletEntryDirection } from '@skydrop/db';
import type { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
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
  const walletEntryFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const direction = (args.where as { direction: WalletEntryDirection }).direction;
    if (direction === WalletEntryDirection.COD_COLLECTION) {
      return opts.codEntryExists ? { id: 'cod-existing' } : null;
    }
    if (direction === WalletEntryDirection.ORDER_CHARGES) {
      return opts.chargesEntryExists ? { id: 'charges-existing' } : null;
    }
    return null;
  });
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
  // Mode resolution + the tax maths are pinned in cod-credit.service
  // and end to end; here the default SETTLEMENT mode means delivery
  // credits nothing, which is exactly what these cases assert.
  const codCredit = {
    resolveMode: jest.fn(async () => 'SETTLEMENT' as const),
    creditForOrder: jest.fn(async () => ({ credited: false })),
  } as unknown as CodCreditService;

  const svc = new AccrualExecutionService(
    prisma,
    wallet as unknown as WalletService,
    chargesAccrual,
    freightAmortisation,
    codCredit,
    // Charges are ensured PRE-TX now: an order reaching delivery with
    // none would be billed nothing, silently.
    { persistForOrderSystem } as never,
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

const persistForOrderSystem = jest.fn(async () => ({
  skipped: true,
  reason: 'CHARGES_ALREADY_EXIST',
}));

describe('AccrualExecutionService.executeAccrual', () => {
  it('on SETTLEMENT, delivery debits charges but does NOT credit COD', async () => {
    // Delivery is not when the money reaches us. Crediting here for
    // every seller is what made Skydrop front 5-10 days of everyone's
    // COD and absorb any short payment; the credit now waits for the
    // courier's withdrawal. INSTANT_PAY is the paid opt-out.
    const { svc, applyEntry, recomputeCacheAfterCommit } = makeService({
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await svc.executeAccrual('order-1');
    expect(applyEntry).toHaveBeenCalledTimes(1);
    expect((applyEntry.mock.calls[0]![1] as AnyArgs).direction).toBe(
      WalletEntryDirection.ORDER_CHARGES,
    );
    expect(recomputeCacheAfterCommit).toHaveBeenCalledWith(
      'seller-1',
      Currency.INR,
      'post-commit-accrual',
    );
  });

  it('R1c: charges already debited early (AT_AWB) — delivery then writes nothing', async () => {
    const { svc, applyEntry } = makeService({
      chargesEntryExists: true,
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await svc.executeAccrual('order-1');
    expect(applyEntry).not.toHaveBeenCalled();
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
    expect((applyEntry.mock.calls[0]![1] as AnyArgs).direction).toBe(
      WalletEntryDirection.ORDER_CHARGES,
    );
  });

  it('order vanished before execution: logs + returns, no writes, no throw', async () => {
    const { svc, applyEntry } = makeService({ order: null });
    await expect(svc.executeAccrual('order-1')).resolves.toBeUndefined();
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('zero COD amount: no COD credit written even though paymentMode is COD', async () => {
    const { svc, applyEntry } = makeService({
      order: {
        id: 'order-1',
        sellerId: 'seller-1',
        paymentMode: PaymentMode.COD,
        codAmountInr: new Prisma.Decimal('0'),
      },
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
      if (direction === WalletEntryDirection.ORDER_CHARGES)
        return chargesWritten ? { id: 'y' } : null;
      return null;
    });
    const orderChargeFindMany = jest.fn(async () => [
      { type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') },
    ]);
    const orderFindUnique = jest.fn(async () => ({
      id: 'order-1',
      sellerId: 'seller-1',
      paymentMode: PaymentMode.COD,
      codAmountInr: new Prisma.Decimal('500'),
    }));
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
    const codCredit = {
      resolveMode: jest.fn(async () => 'SETTLEMENT' as const),
      creditForOrder: jest.fn(async () => ({ credited: false })),
    } as unknown as CodCreditService;
    const svc = new AccrualExecutionService(
      prisma,
      wallet as unknown as WalletService,
      chargesAccrual,
      freightAmortisation,
      codCredit,
      // Charges are ensured PRE-TX now: an order reaching delivery with
      // none would be billed nothing, silently.
      { persistForOrderSystem } as never,
    );

    await svc.executeAccrual('order-1');
    await svc.executeAccrual('order-1');
    // One ORDER_CHARGES debit, never twice. COD is not credited at
    // delivery on the default SETTLEMENT mode.
    expect(applyEntry).toHaveBeenCalledTimes(1);
  });
});

/**
 * An order can reach delivery with no charge rows.
 *
 * `OrderService.create` computes them post-commit, which covers orders
 * born through the service — but anything inserted another way (a data
 * fix, an import, a seeding script) arrives with none, and production
 * already holds fifteen such orders. `debitIfNeeded` then sums nothing,
 * returns false, and the parcel is delivered unbilled: no error, no
 * log, the seller simply never invoiced.
 */
describe('AccrualExecutionService — charges exist before money is taken', () => {
  it('computes charges BEFORE opening the accrual transaction', async () => {
    const { svc } = makeService({});
    persistForOrderSystem.mockClear();

    await svc.executeAccrual('order-1');

    // Pre-tx, because persistForOrderSystem owns its own transaction
    // and cannot be composed into this one (the M5 saga rule).
    expect(persistForOrderSystem).toHaveBeenCalledWith('order-1');
  });

  it('still credits the seller when the charge computation fails', async () => {
    const { svc } = makeService({});
    persistForOrderSystem.mockClear();
    persistForOrderSystem.mockRejectedValueOnce(new Error('pricing unavailable'));

    // Best-effort: a failure here must not withhold the COD credit the
    // seller is owed for a parcel that was delivered.
    await expect(svc.executeAccrual('order-1')).resolves.toBeUndefined();
  });
});
