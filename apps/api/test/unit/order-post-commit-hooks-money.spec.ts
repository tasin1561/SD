import { ConflictException } from '@nestjs/common';
import { OrderStatus, SellerStoreKind } from '@skydrop/db';
import {
  OrderPostCommitHooksService,
  resellerMoneyDivergedIssueKey,
  resellerMoneyStaleIssueKey,
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
    /** What `recalculateAfterEdit` does when the money hook asks. */
    recalcThrows?: Error;
    credits?: Array<Record<string, unknown>>;
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
  const recalculateAfterEdit = jest.fn(async () => {
    if (opts.recalcThrows) throw opts.recalcThrows;
    return { outcome: 'REPLANNED', parties: [], prepaid: null };
  });
  const orderChangedByAdmin = jest.fn(async (_input: Record<string, unknown>) => undefined);
  const resolveByKey = jest.fn(async () => 0);
  const client = {
    order: {
      findFirst: jest.fn(async () => ({ ...order, orderNumber: 'SD-A' })),
    },
    shipment: { count: jest.fn(async () => opts.handedOver ?? 0) },
    orderEvent: { findMany: jest.fn(async () => []) },
    resellerOrderCredit: { findMany: jest.fn(async () => opts.credits ?? []) },
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
    { raise, resolveByKey } as never,
    { recalculateAfterEdit } as never,
    { orderChangedByAdmin } as never,
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
    resolveByKey,
    provisionFromSnapshot,
    recalculateAfterEdit,
    orderChangedByAdmin,
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

/**
 * FIX 1 + FIX 2 (2026-09-19) — a money-affecting change to a RESELLER
 * order is re-priced through ONE shared hook, whichever writer made it,
 * and the two ways it can fail to be are both LOUD.
 *
 * God mode (ORD-2) can write `codAmountInr` and `paymentMode` and used
 * to call nothing at all, so a forced COD left the order saying one
 * figure and its credits worked out from another, silently. The edit
 * path's own failure was a HIGH audit row, and nothing reads audit rows.
 */
describe('OrderPostCommitHooksService — a reseller order re-priced after it changed', () => {
  const announce = {
    storeId: 'store-1',
    storeKind: SellerStoreKind.RESELLER,
    changes: 'Cash to collect: 1180.00 → 1500.00',
    eventKey: 'o1:1',
  };
  const edit = (over: Record<string, unknown> = {}) => ({
    orderId: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-A',
    changed: ['codAmountInr'],
    reason: 'forced',
    ...over,
  });

  it('does not ask when nothing money-affecting moved', async () => {
    const h = make();
    const out = await h.svc.runForMoneyAffectingEdit(edit({ changed: ['recipientName'] }));
    expect(out).toEqual({ ran: false, result: null, refusal: null });
    expect(h.recalculateAfterEdit).not.toHaveBeenCalled();
  });

  it.each([['codAmountInr'], ['paymentMode'], ['items']])(
    'asks when %s moved — the ONE list both writers read',
    async (field) => {
      const h = make();
      await h.svc.runForMoneyAffectingEdit(edit({ changed: [field, 'recipientName'] }));
      expect(h.recalculateAfterEdit).toHaveBeenCalledTimes(1);
    },
  );

  it('on success it clears BOTH alarms, so a divergence somebody fixed stops shouting', async () => {
    const h = make();
    const out = await h.svc.runForMoneyAffectingEdit(edit());
    expect(out.refusal).toBeNull();
    expect(h.resolveByKey).toHaveBeenCalledWith(
      resellerMoneyStaleIssueKey('o1'),
      expect.any(String),
    );
    expect(h.resolveByKey).toHaveBeenCalledWith(
      resellerMoneyDivergedIssueKey('o1'),
      expect.any(String),
    );
    expect(h.raise).not.toHaveBeenCalled();
  });

  it('a credit already PAID raises a HIGH MONEY issue naming what was credited, and is never retried', async () => {
    const h = make({
      recalcThrows: new ConflictException({
        code: 'RESELLER_CREDIT_ALREADY_PAID',
        message: 'already paid',
      }),
      credits: [
        {
          party: 'STORE',
          status: 'CREDITED',
          netInr: { toFixed: () => '965.00' },
          creditedAt: null,
        },
      ],
    });
    const out = await h.svc.runForMoneyAffectingEdit(edit());
    expect(out.refusal).toBe('ALREADY_PAID');
    expect(h.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MONEY',
        severity: 'HIGH',
        dedupeKey: resellerMoneyDivergedIssueKey('o1'),
        detail: expect.stringContaining('965.00'),
        metadata: expect.objectContaining({ code: 'RESELLER_CREDIT_ALREADY_PAID' }),
      }),
    );
    // The retry alarm is stood down: asking again cannot change a paid credit.
    expect(h.resolveByKey).toHaveBeenCalledWith(
      resellerMoneyStaleIssueKey('o1'),
      expect.any(String),
    );
  });

  it('any other failure raises the RETRYABLE issue the sweep works from', async () => {
    const h = make({ recalcThrows: new Error('lock timeout') });
    const out = await h.svc.runForMoneyAffectingEdit(edit());
    expect(out.refusal).toBe('FAILED');
    expect(h.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MONEY',
        severity: 'HIGH',
        dedupeKey: resellerMoneyStaleIssueKey('o1'),
      }),
    );
  });

  it('never throws into the writer, whatever the money says', async () => {
    const h = make({ recalcThrows: new Error('boom') });
    await expect(h.svc.runForMoneyAffectingEdit(edit())).resolves.toEqual(
      expect.objectContaining({ ran: true }),
    );
  });

  it('god mode tells BOTH parties — neither of them made the change', async () => {
    const h = make();
    await h.svc.runForMoneyAffectingEdit(edit({ announce }));
    expect(h.orderChangedByAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        orderNumber: 'SD-A',
        changes: 'Cash to collect: 1180.00 → 1500.00',
      }),
    );
  });

  it('the store is told the money could NOT be re-worked-out, not silence', async () => {
    const h = make({
      recalcThrows: new ConflictException({
        code: 'RESELLER_CREDIT_ALREADY_PAID',
        message: 'already paid',
      }),
    });
    await h.svc.runForMoneyAffectingEdit(edit({ announce }));
    const said = (
      h.orderChangedByAdmin.mock.calls as unknown as Array<[{ money: string }]>
    )[0]?.[0];
    expect(said?.money).toMatch(/already been paid out/i);
  });

  it('a CHANNEL order tells nobody — there is no store on the other side of it', async () => {
    const h = make();
    await h.svc.runForMoneyAffectingEdit(
      edit({ announce: { ...announce, storeKind: SellerStoreKind.CHANNEL } }),
    );
    expect(h.orderChangedByAdmin).not.toHaveBeenCalled();
  });

  it('the ordinary edit path announces nothing from here — it tells them itself', async () => {
    const h = make();
    await h.svc.runForMoneyAffectingEdit(edit());
    expect(h.orderChangedByAdmin).not.toHaveBeenCalled();
  });

  it('the retry asks again for a named order and clears the alarm on success', async () => {
    const h = make();
    const out = await h.svc.retryResellerMoneyRecalculation('o1');
    expect(out.refusal).toBeNull();
    expect(h.recalculateAfterEdit).toHaveBeenCalledTimes(1);
    expect(h.resolveByKey).toHaveBeenCalledWith(
      resellerMoneyStaleIssueKey('o1'),
      expect.any(String),
    );
    // A retry is not a change: nobody is told again.
    expect(h.orderChangedByAdmin).not.toHaveBeenCalled();
  });
});
