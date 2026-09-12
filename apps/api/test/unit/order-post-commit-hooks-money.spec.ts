import { OrderStatus } from '@skydrop/db';
import {
  OrderPostCommitHooksService,
  shipmentMissingIssueKey,
} from '../../src/modules/order/services/order-post-commit-hooks.service';

type AnyArgs = Record<string, unknown>;

/**
 * The money side of an order ENDING — run by BOTH writers of
 * orders.status through the one shared hooks service (ORD-2 / ORD-3).
 *
 *  - A called-off order whose parcel never left: the deferred accrual is
 *    retired, the delivery fee refunded, and an Instant Pay credit no
 *    courier paid for is taken back.
 *  - A LOST parcel is not charged (TRE-6): fee refunded, accrual retired.
 *  - A confirmed order whose provision failed is RAISED — nothing else
 *    would see it.
 */
function make(
  opts: {
    handedOver?: number;
    provisionThrows?: string;
  } = {},
) {
  const refundIfCharged = jest.fn(async () => null);
  const retirePendingAccrual = jest.fn(async (_o: string, _r: string) => 1);
  const reverseUncoveredInstantPayCredit = jest.fn(async () => ({ reversed: false }));
  const raise = jest.fn(async (_i: AnyArgs) => undefined);
  const provisionFromSnapshot = jest.fn(async () => {
    if (opts.provisionThrows) throw new Error(opts.provisionThrows);
    return { shipmentId: 'ship-1', created: true };
  });
  const order = {
    id: 'o1',
    sellerId: 's1',
    recipientName: 'A',
    recipientPhoneE164: '+919876543210',
    recipientAddressLine1: 'l1',
    recipientAddressLine2: 'l2',
    recipientLandmark: null,
    recipientCity: '',
    recipientStateProvince: '',
    recipientPostalCode: '560001',
    recipientCountryCode: 'IN',
    declaredValueInr: 100,
    codAmountInr: null,
    items: [],
  };
  const client = {
    order: { findFirst: jest.fn(async () => order) },
    shipment: { count: jest.fn(async () => opts.handedOver ?? 0) },
    orderEvent: { findMany: jest.fn(async () => []) },
  };
  const svc = new OrderPostCommitHooksService(
    { client } as never,
    { log: jest.fn(async () => 'a') } as never,
    { enqueueOrder: jest.fn(), dequeueOrder: jest.fn(async () => ({ dequeued: 0 })) } as never,
    { provisionFromSnapshot, voidForOrder: jest.fn(async () => ({ voided: 1 })) } as never,
    { refundIfCharged } as never,
    { emit: jest.fn() } as never,
    { resolve: jest.fn(async () => ({ value: 'delhivery' })) } as never,
    { retirePendingAccrual, reverseUncoveredInstantPayCredit } as never,
    { raise } as never,
  );
  const run = (
    from: OrderStatus,
    landed: OrderStatus,
    source: 'TRANSITION' | 'ADMIN_OVERRIDE' = 'TRANSITION',
  ): Promise<void> =>
    svc.runForStatusChange({
      orderId: 'o1',
      sellerId: 's1',
      from,
      landed,
      statusEventId: 'sc1',
      actor: { type: 'STAFF', id: 'staff-1' } as never,
      source,
    });
  return {
    svc,
    run,
    refundIfCharged,
    retirePendingAccrual,
    reverseUncoveredInstantPayCredit,
    raise,
    provisionFromSnapshot,
  };
}

describe('OrderPostCommitHooksService — money when an order ends', () => {
  it('a cancel before dispatch: retires the accrual, refunds the fee, takes back an unpaid Instant Pay credit', async () => {
    const h = make();
    await h.run(OrderStatus.PACKED, OrderStatus.CANCELLED_BY_ADMIN);
    expect(h.retirePendingAccrual).toHaveBeenCalledWith('o1', 'ORDER_CANCELLED_BY_ADMIN');
    expect(h.refundIfCharged).toHaveBeenCalledTimes(1);
    expect(h.reverseUncoveredInstantPayCredit).toHaveBeenCalledWith('o1', 's1', expect.any(String));
  });

  it('a god-mode cancel of a forced DELIVERED that never left: the same unwind, judged on history', async () => {
    // The T+N accrual scheduled at the forced delivery would otherwise
    // bill this cancelled order up to seven days later.
    const h = make({ handedOver: 0 });
    await h.run(OrderStatus.DELIVERED, OrderStatus.CANCELLED_BY_ADMIN, 'ADMIN_OVERRIDE');
    expect(h.retirePendingAccrual).toHaveBeenCalled();
    expect(h.refundIfCharged).toHaveBeenCalled();
    expect(h.reverseUncoveredInstantPayCredit).toHaveBeenCalled();
  });

  it('a cancel after the courier had the parcel: the accrual is retired, but nothing is refunded or reversed', async () => {
    const h = make({ handedOver: 1 });
    await h.run(OrderStatus.DELIVERED, OrderStatus.CANCELLED_BY_ADMIN, 'ADMIN_OVERRIDE');
    expect(h.retirePendingAccrual).toHaveBeenCalled();
    expect(h.refundIfCharged).not.toHaveBeenCalled();
    expect(h.reverseUncoveredInstantPayCredit).not.toHaveBeenCalled();
  });

  it('a matrix cancel from DISPATCHED refunds nothing — its `from` is a fact', async () => {
    const h = make();
    await h.run(OrderStatus.DISPATCHED, OrderStatus.CANCELLED_BY_ADMIN);
    expect(h.refundIfCharged).not.toHaveBeenCalled();
  });

  it('LOST_IN_TRANSIT: a lost parcel is not charged — fee refunded and accrual retired, whoever had it', async () => {
    const h = make({ handedOver: 1 });
    await h.run(OrderStatus.IN_TRANSIT, OrderStatus.LOST_IN_TRANSIT);
    expect(h.retirePendingAccrual).toHaveBeenCalledWith('o1', 'ORDER_LOST_IN_TRANSIT');
    expect(h.refundIfCharged).toHaveBeenCalledWith('o1', 's1', expect.stringMatching(/lost/i));
    // A COD credit only exists after a delivery; the loss path does not touch it.
    expect(h.reverseUncoveredInstantPayCredit).not.toHaveBeenCalled();
  });

  it('one money step failing does not stop the next', async () => {
    const h = make();
    h.retirePendingAccrual.mockRejectedValueOnce(new Error('db blinked'));
    await h.run(OrderStatus.CONFIRMED, OrderStatus.CANCELLED);
    expect(h.refundIfCharged).toHaveBeenCalled();
    expect(h.reverseUncoveredInstantPayCredit).toHaveBeenCalled();
  });
});

describe('OrderPostCommitHooksService — a provision that fails is RAISED', () => {
  it('raises a HIGH issue keyed per order, and never throws into the transition', async () => {
    const h = make({ provisionThrows: 'ops.default_courier_code resolved empty' });
    await expect(h.run(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED)).resolves.toBe(
      undefined,
    );
    expect(h.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'HIGH',
        dedupeKey: shipmentMissingIssueKey('o1'),
        metadata: expect.objectContaining({ orderId: 'o1' }),
      }),
    );
  });

  it('ensureShipmentProvisioned re-reads the committed order and THROWS on failure', async () => {
    const ok = make();
    await expect(ok.svc.ensureShipmentProvisioned('o1')).resolves.toEqual({
      shipmentId: 'ship-1',
      created: true,
    });
    const bad = make({ provisionThrows: 'no warehouse' });
    await expect(bad.svc.ensureShipmentProvisioned('o1')).rejects.toThrow('no warehouse');
    expect(bad.raise).not.toHaveBeenCalled();
  });
});
