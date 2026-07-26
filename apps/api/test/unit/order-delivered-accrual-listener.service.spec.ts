import {
  ActorType,
  Currency,
  OrderStatus,
  PaymentMode,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { OrderDeliveredAccrualListener } from '../../src/modules/seller-wallet-accrual/services/order-delivered-accrual-listener.service';
import { OrderChargesAccrualService } from '../../src/modules/seller-wallet-accrual/services/order-charges-accrual.service';
import type { OrderLifecycleEvent, OrderLifecycleEventBus } from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

type AnyArgs = Record<string, unknown>;

function lifecycleEvent(to: OrderStatus, orderId = 'order-1'): OrderLifecycleEvent {
  return {
    orderId,
    sellerId: 'seller-1',
    from: OrderStatus.OUT_FOR_DELIVERY,
    to,
    statusEventId: 'evt-1',
    actorType: ActorType.SYSTEM,
    actorId: null,
    occurredAt: new Date(),
  };
}

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

  const bus = { subscribe: jest.fn() } as unknown as OrderLifecycleEventBus;
  const chargesAccrual = new OrderChargesAccrualService(wallet as unknown as WalletService);

  const listener = new OrderDeliveredAccrualListener(
    bus,
    prisma,
    wallet as unknown as WalletService,
    chargesAccrual,
  );
  return { listener, applyEntry, recomputeCacheAfterCommit, orderFindUnique, orderChargeFindMany, walletEntryFindFirst };
}

describe('OrderDeliveredAccrualListener.handle', () => {
  it('ignores every transition except DELIVERED', async () => {
    const { listener, applyEntry } = makeService();
    await listener.handle(lifecycleEvent(OrderStatus.DISPATCHED));
    await listener.handle(lifecycleEvent(OrderStatus.OUT_FOR_DELIVERY));
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('COD DELIVERED, nothing debited yet: credits COD + debits charges in one tx', async () => {
    const { listener, applyEntry, recomputeCacheAfterCommit } = makeService({
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(applyEntry).toHaveBeenCalledTimes(2);
    const directions = applyEntry.mock.calls.map((c) => (c[1] as AnyArgs).direction);
    expect(directions).toEqual(
      expect.arrayContaining([WalletEntryDirection.COD_COLLECTION, WalletEntryDirection.ORDER_CHARGES]),
    );
    expect(recomputeCacheAfterCommit).toHaveBeenCalledWith('seller-1', Currency.INR, 'post-commit-accrual');
  });

  it('R1c: charges already debited early (AT_AWB) — DELIVERED still credits COD, does NOT re-debit charges', async () => {
    const { listener, applyEntry } = makeService({
      chargesEntryExists: true,
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(applyEntry).toHaveBeenCalledTimes(1);
    expect((applyEntry.mock.calls[0]![1] as AnyArgs).direction).toBe(WalletEntryDirection.COD_COLLECTION);
  });

  it('fully processed already (both entries exist): no writes at all, still succeeds', async () => {
    const { listener, applyEntry } = makeService({ codEntryExists: true, chargesEntryExists: true });
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('PREPAID order: no COD credit, charges still debited', async () => {
    const { listener, applyEntry } = makeService({
      order: {
        id: 'order-1',
        sellerId: 'seller-1',
        paymentMode: PaymentMode.PREPAID,
        codAmountInr: null,
      },
      charges: [{ type: 'BASE_SHIPPING', amountInr: new Prisma.Decimal('80') }],
    });
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(applyEntry).toHaveBeenCalledTimes(1);
    expect((applyEntry.mock.calls[0]![1] as AnyArgs).direction).toBe(WalletEntryDirection.ORDER_CHARGES);
  });

  it('order vanished between emit and handle: logs + returns, no writes, no throw', async () => {
    const { listener, applyEntry } = makeService({ order: null });
    await expect(listener.handle(lifecycleEvent(OrderStatus.DELIVERED))).resolves.toBeUndefined();
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('zero COD amount: no COD credit written even though paymentMode is COD', async () => {
    const { listener, applyEntry } = makeService({
      order: { id: 'order-1', sellerId: 'seller-1', paymentMode: PaymentMode.COD, codAmountInr: new Prisma.Decimal('0') },
    });
    await listener.handle(lifecycleEvent(OrderStatus.DELIVERED));
    expect(applyEntry).not.toHaveBeenCalled();
  });
});
