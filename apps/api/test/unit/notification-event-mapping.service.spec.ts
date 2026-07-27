import { NotificationChannel, NotificationRecipientType, OrderStatus } from '@skydrop/db';
import { NotificationEventMappingService } from '../../src/modules/notifications/services/notification-event-mapping.service';

const svc = new NotificationEventMappingService();

/**
 * Module 11 (NOTIF-4) — the consistency test for the third
 * single-source-mapping service. Mirrors the call-outcome-mapping.service
 * .spec and tracking-status-mapping.service.spec patterns.
 *
 * The PRIMARY guard is in the production code: the exhaustive switch
 * over OrderStatus + `assertNever` default makes a missing enum value a
 * COMPILE error. This suite is the secondary guard: it pins the Q5
 * table verbatim — accidentally widening/narrowing a fan-out fails
 * here, and a future case-passes-through to `assertNever` is caught.
 */
describe('NotificationEventMappingService (NOTIF-4)', () => {
  describe('Q5 fan-out table — order status → fan-out targets', () => {
    type Row = readonly [OrderStatus, ReadonlyArray<[NotificationRecipientType, string]>];

    // The exact Q5 table — each row is "<status> → [(recipient, template), …]"
    // ordered seller-then-customer. The templates resolve in commit 2's
    // seed; an unknown template would fail the "templates are seeded"
    // suite below.
    const Q5: readonly Row[] = [
      [
        OrderStatus.CONFIRMED,
        [
          [NotificationRecipientType.SELLER, 'order.confirmed.seller.email'],
          [NotificationRecipientType.CUSTOMER, 'customer.order_confirmed.email'],
        ],
      ],
      [
        OrderStatus.DISPATCHED,
        [
          [NotificationRecipientType.SELLER, 'seller.order_dispatched.email'],
          [NotificationRecipientType.CUSTOMER, 'customer.order_dispatched.email'],
        ],
      ],
      [
        OrderStatus.OUT_FOR_DELIVERY,
        [[NotificationRecipientType.CUSTOMER, 'customer.order_out_for_delivery.email']],
      ],
      [
        OrderStatus.DELIVERED,
        [
          [NotificationRecipientType.SELLER, 'seller.order_delivered.email'],
          [NotificationRecipientType.CUSTOMER, 'customer.order_delivered.email'],
        ],
      ],
      [
        OrderStatus.DELIVERY_FAILED,
        [
          [NotificationRecipientType.SELLER, 'seller.order_delivery_failed.email'],
          [NotificationRecipientType.CUSTOMER, 'customer.order_delivery_failed.email'],
        ],
      ],
      [
        OrderStatus.RTO_INITIATED,
        [[NotificationRecipientType.SELLER, 'shipment.rto_initiated.seller.email']],
      ],
      [
        OrderStatus.RTO_RECEIVED,
        [[NotificationRecipientType.SELLER, 'seller.order_rto_received.email']],
      ],
      [
        OrderStatus.CANCELLED,
        [
          [NotificationRecipientType.SELLER, 'seller.order_cancelled.email'],
          [NotificationRecipientType.CUSTOMER, 'customer.order_cancelled.email'],
        ],
      ],
    ];

    it.each(Q5)('%s → expected fan-out', (status, expected) => {
      const got = svc.resolveForOrderStatus(status);
      expect(got.map((f) => [f.recipientType, f.templateCode])).toEqual(expected);
      // Phase-1A: every fan-out is EMAIL.
      expect(got.every((f) => f.channel === NotificationChannel.EMAIL)).toBe(true);
      // Phase-1A: every fan-out renders against the 'en'-tagged
      // template; the customer bilingual text lives in the seeded
      // body, not as a separate 'hi' row (Q6).
      expect(got.every((f) => f.locale === 'en')).toBe(true);
    });
  });

  describe('every OrderStatus NOT in the Q5 table fans out to []', () => {
    // PENDING_MANUAL_PLACEMENT — Q5 explicit "internal-only, NO notification".
    // Pre-confirm: DRAFT, PENDING_CONFIRMATION, CALL_NO_RESPONSE,
    //   CALL_RESCHEDULED, OUT_OF_STOCK.
    // Admin / rejection terminals (Phase-2 may revisit per debt entry):
    //   CANCELLED_BY_ADMIN, REJECTED, REJECTED_BY_CUSTOMER, REJECTED_NDR.
    // Warehouse internal: PENDING_PICK, PICKED, PACKED, PACK_FAILED,
    //   PENDING_DISPATCH.
    // In-flight (DISPATCHED + the customer-only OFD + the seller+customer
    //   DELIVERED + DELIVERY_FAILED are covered by the Q5 table above):
    //   IN_TRANSIT.
    // RTO downstream: RTO_IN_TRANSIT, RTO_RESTOCKED, RTO_DAMAGED,
    //   LOST_IN_TRANSIT.
    it.each([
      OrderStatus.DRAFT,
      OrderStatus.PENDING_CONFIRMATION,
      OrderStatus.CALL_NO_RESPONSE,
      OrderStatus.CALL_RESCHEDULED,
      OrderStatus.OUT_OF_STOCK,
      OrderStatus.CANCELLED_BY_ADMIN,
      OrderStatus.REJECTED,
      OrderStatus.REJECTED_BY_CUSTOMER,
      OrderStatus.REJECTED_NDR,
      OrderStatus.PENDING_PICK,
      OrderStatus.PICKED,
      OrderStatus.PACKED,
      OrderStatus.PACK_FAILED,
      OrderStatus.PENDING_DISPATCH,
      OrderStatus.IN_TRANSIT,
      OrderStatus.RTO_IN_TRANSIT,
      OrderStatus.RTO_RESTOCKED,
      OrderStatus.RTO_DAMAGED,
      OrderStatus.LOST_IN_TRANSIT,
      OrderStatus.PENDING_MANUAL_PLACEMENT,
    ])('%s → []', (status) => {
      expect(svc.resolveForOrderStatus(status)).toEqual([]);
    });
  });

  describe('exhaustiveness — every OrderStatus enum value is routed', () => {
    it('walks the full enum without falling through to assertNever', () => {
      // If a new OrderStatus value is added without a case, this
      // iteration will hit the `default → assertNever` branch and
      // throw. The PRIMARY guard is the compile error in production
      // code; this test is the secondary runtime check.
      const all = Object.values(OrderStatus) as OrderStatus[];
      expect(all.length).toBeGreaterThan(0);
      for (const s of all) {
        expect(() => svc.resolveForOrderStatus(s)).not.toThrow();
      }
    });
  });

  describe('DISPATCHED is the M10 tracking-link priority template', () => {
    it('customer fan-out for DISPATCHED uses customer.order_dispatched.email', () => {
      const fan = svc.resolveForOrderStatus(OrderStatus.DISPATCHED);
      const customer = fan.find((f) => f.recipientType === NotificationRecipientType.CUSTOMER);
      expect(customer).toBeDefined();
      // The tracking URL itself lives in the SEEDED template body
      // (customer.order_dispatched.email — verified by the e2e in
      // commit 9 which renders the template and asserts the URL); the
      // mapping's only contract is to route here.
      expect(customer?.templateCode).toBe('customer.order_dispatched.email');
    });
  });
});

// R5b — the one lifecycle status that REQUIRES the seller to act.
describe('NotificationEventMappingService — R5b AWAITING_SELLER_DECISION', () => {
  it('notifies the SELLER (and only the seller)', () => {
    const svc = new NotificationEventMappingService();
    const out = svc.resolveForOrderStatus(OrderStatus.AWAITING_SELLER_DECISION);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      recipientType: NotificationRecipientType.SELLER,
      templateCode: 'seller.order_awaiting_decision.email',
      channel: NotificationChannel.EMAIL,
    });
  });

  it('is NOT silent like the reject family — a seller who never hears loses money', () => {
    const svc = new NotificationEventMappingService();
    // The rejects are deliberately silent in Phase-1A; the pause is not,
    // because the order is waiting on the seller and may hold their stock.
    expect(svc.resolveForOrderStatus(OrderStatus.REJECTED_NDR)).toHaveLength(0);
    expect(svc.resolveForOrderStatus(OrderStatus.AWAITING_SELLER_DECISION).length).toBeGreaterThan(
      0,
    );
  });
});
