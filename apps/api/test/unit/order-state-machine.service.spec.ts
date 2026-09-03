import { OrderStatus } from '@skydrop/db';
import {
  OrderSideEffect,
  OrderStateMachineService,
} from '../../src/modules/order/services/order-state-machine.service';

// Neither REJECTED_BY_CUSTOMER nor REJECTED_NDR is terminal any more.
// Each has exactly ONE edge out, back to PENDING_CONFIRMATION, and the
// only thing that can take it is an ADMIN-APPROVED seller request
// (OrderReattemptService). Nothing reaches either unaided.
//
// REJECTED_NDR's edge is OFF by default: reaching it also requires the
// status to be named in `orders.reattempt_requestable_statuses`, which
// is seeded with REJECTED_BY_CUSTOMER alone. The edge existing is what
// lets an operator turn it on; it is not what turns it on.
// DELIVERED is NO LONGER TERMINAL. A customer can ask for a delivered
// parcel back, and that is the one lifecycle move a finished order still
// has — DELIVERED → RTO_INITIATED, from where it travels the existing
// return path home. Everything else about it is unchanged: the edge
// carries no side-effects, because the goods have not moved yet.
const TERMINAL: OrderStatus[] = [
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
  OrderStatus.LOST_IN_TRANSIT,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
];

describe('OrderStateMachineService', () => {
  const sm = new OrderStateMachineService();

  // ── R5b: the pause between the call cap and rejection ───────────────
  describe('R5b AWAITING_SELLER_DECISION', () => {
    it('is reachable from every state the call cap can land on', () => {
      const sm = new OrderStateMachineService();
      for (const from of [
        OrderStatus.PENDING_CONFIRMATION,
        OrderStatus.CALL_NO_RESPONSE,
        OrderStatus.CALL_RESCHEDULED,
      ]) {
        expect(sm.isValidTransition(from, OrderStatus.AWAITING_SELLER_DECISION)).toBe(true);
      }
    });

    it('is NOT terminal — both seller answers have an edge out', () => {
      const sm = new OrderStateMachineService();
      // "keep trying" goes back into the call queue...
      expect(
        sm.isValidTransition(
          OrderStatus.AWAITING_SELLER_DECISION,
          OrderStatus.PENDING_CONFIRMATION,
        ),
      ).toBe(true);
      // ...and "release" (or the TTL sweep) lands the original terminal.
      expect(
        sm.isValidTransition(OrderStatus.AWAITING_SELLER_DECISION, OrderStatus.REJECTED_NDR),
      ).toBe(true);
    });

    it('carries NO stock side-effects — the hold is managed by R5, not the matrix', () => {
      const sm = new OrderStateMachineService();
      for (const to of [OrderStatus.PENDING_CONFIRMATION, OrderStatus.REJECTED_NDR]) {
        expect(sm.requiredSideEffects(OrderStatus.AWAITING_SELLER_DECISION, to)).toEqual([]);
      }
    });

    it('an admin can still cancel a paused order', () => {
      const sm = new OrderStateMachineService();
      expect(
        sm.isValidTransition(OrderStatus.AWAITING_SELLER_DECISION, OrderStatus.CANCELLED_BY_ADMIN),
      ).toBe(true);
    });
  });

  it('covers all 29 OrderStatus values as graph keys', () => {
    const all = Object.values(OrderStatus);
    expect(all).toHaveLength(29);
    for (const s of all) {
      // never throws / never undefined for a real status
      expect(Array.isArray(sm.getAllowedTransitions(s))).toBe(true);
    }
  });

  it('marks exactly the expected terminal states', () => {
    for (const s of Object.values(OrderStatus)) {
      expect(sm.isTerminal(s)).toBe(TERMINAL.includes(s));
    }
  });

  describe('valid transitions', () => {
    it('DRAFT → PENDING_CONFIRMATION (submit), no side-effects', () => {
      expect(sm.isValidTransition(OrderStatus.DRAFT, OrderStatus.PENDING_CONFIRMATION)).toBe(true);
      expect(sm.requiredSideEffects(OrderStatus.DRAFT, OrderStatus.PENDING_CONFIRMATION)).toEqual(
        [],
      );
    });

    it('PENDING_CONFIRMATION → CONFIRMED reserves stock', () => {
      expect(
        sm.requiredSideEffects(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED),
      ).toEqual([OrderSideEffect.RESERVE_STOCK]);
    });

    it.each([OrderStatus.CALL_NO_RESPONSE, OrderStatus.CALL_RESCHEDULED, OrderStatus.OUT_OF_STOCK])(
      '%s → CONFIRMED also reserves stock',
      (from) => {
        expect(sm.requiredSideEffects(from, OrderStatus.CONFIRMED)).toEqual([
          OrderSideEffect.RESERVE_STOCK,
        ]);
      },
    );

    it('PENDING_CONFIRMATION → OUT_OF_STOCK is valid with NO side-effects', () => {
      expect(sm.isValidTransition(OrderStatus.PENDING_CONFIRMATION, OrderStatus.OUT_OF_STOCK)).toBe(
        true,
      );
      expect(
        sm.requiredSideEffects(OrderStatus.PENDING_CONFIRMATION, OrderStatus.OUT_OF_STOCK),
      ).toEqual([]);
    });

    it('CONFIRMED → CANCELLED / CANCELLED_BY_ADMIN / REJECTED all release stock', () => {
      for (const to of [
        OrderStatus.CANCELLED,
        OrderStatus.CANCELLED_BY_ADMIN,
        OrderStatus.REJECTED,
      ]) {
        expect(sm.requiredSideEffects(OrderStatus.CONFIRMED, to)).toEqual([
          OrderSideEffect.RELEASE_STOCK,
        ]);
      }
    });

    it('PICKED → PACKED carries DISPATCH_STOCK (Model C, 2026-09-03 — the decrement moved here)', () => {
      expect(sm.requiredSideEffects(OrderStatus.PICKED, OrderStatus.PACKED)).toEqual([
        OrderSideEffect.DISPATCH_STOCK,
      ]);
    });

    it('PACKED → DISPATCHED exists, so the handover bench can dispatch without a manifest', () => {
      // The scan at the door is the true handover. Before this edge
      // existed, the ONLY way out of PACKED was ManifestService.close,
      // which made an internal grouping a mandatory step in a physical
      // process it has nothing to do with.
      expect(sm.isValidTransition(OrderStatus.PACKED, OrderStatus.DISPATCHED)).toBe(true);
    });

    it('PACKED → DISPATCHED is STOCK-NEUTRAL (Model C — the box was already counted out at pack)', () => {
      expect(sm.requiredSideEffects(OrderStatus.PACKED, OrderStatus.DISPATCHED)).toEqual([]);
    });

    it('PENDING_DISPATCH → DISPATCHED is STOCK-NEUTRAL (Model C — decremented + fulfilled at PACK already)', () => {
      expect(sm.requiredSideEffects(OrderStatus.PENDING_DISPATCH, OrderStatus.DISPATCHED)).toEqual(
        [],
      );
    });

    it('OUT_FOR_DELIVERY → DELIVERED is STOCK-NEUTRAL (Model C — qtyOnHand decremented + fulfilled at PACK)', () => {
      expect(sm.requiredSideEffects(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED)).toEqual(
        [],
      );
    });

    it('a parcel still in the building on cancel gets its stock GIVEN BACK (PACKED → CANCELLED_BY_ADMIN)', () => {
      // Model C: qtyOnHand already moved at PACKED, so plain
      // RELEASE_STOCK (which would just no-op an already-FULFILLED
      // reservation) is not enough — UNPACK_STOCK reverses the physical
      // decrement too.
      expect(sm.requiredSideEffects(OrderStatus.PACKED, OrderStatus.CANCELLED_BY_ADMIN)).toEqual([
        OrderSideEffect.UNPACK_STOCK,
      ]);
    });

    it('a parcel already with a courier on cancel does NOT get stock back (DISPATCHED → CANCELLED_BY_ADMIN)', () => {
      // The goods are gone from the building for real by now — RELEASE_STOCK
      // stays plain (a no-op on the already-FULFILLED reservation), and
      // giving stock back here would invent inventory that is not there.
      expect(
        sm.requiredSideEffects(OrderStatus.DISPATCHED, OrderStatus.CANCELLED_BY_ADMIN),
      ).toEqual([OrderSideEffect.RELEASE_STOCK]);
    });
  });

  describe('the critical no-release-before-reserve property', () => {
    it.each([
      OrderStatus.PENDING_CONFIRMATION,
      OrderStatus.CALL_NO_RESPONSE,
      OrderStatus.CALL_RESCHEDULED,
      OrderStatus.OUT_OF_STOCK,
    ])('%s → CANCELLED has NO RELEASE_STOCK (nothing reserved yet)', (from) => {
      expect(sm.isValidTransition(from, OrderStatus.CANCELLED)).toBe(true);
      expect(sm.requiredSideEffects(from, OrderStatus.CANCELLED)).toEqual([]);
    });

    it('DRAFT → CANCELLED has no side-effects', () => {
      expect(sm.requiredSideEffects(OrderStatus.DRAFT, OrderStatus.CANCELLED)).toEqual([]);
    });
  });

  describe('Module 7 call-workflow edges (REJECTED_BY_CUSTOMER / NDR)', () => {
    it.each([
      OrderStatus.PENDING_CONFIRMATION,
      OrderStatus.CALL_NO_RESPONSE,
      OrderStatus.CALL_RESCHEDULED,
    ])('%s → REJECTED_BY_CUSTOMER / REJECTED_NDR valid, no side-effects', (from) => {
      for (const to of [OrderStatus.REJECTED_BY_CUSTOMER, OrderStatus.REJECTED_NDR]) {
        expect(sm.isValidTransition(from, to)).toBe(true);
        expect(sm.requiredSideEffects(from, to)).toEqual([]);
      }
    });

    it.each([OrderStatus.REJECTED_BY_CUSTOMER, OrderStatus.REJECTED_NDR])(
      '%s has exactly ONE way back, and only that one',
      (s) => {
        // The edge exists so an approved re-attempt request has
        // somewhere to go. Anything else out of a rejection would be a
        // way to ring a customer again without a human agreeing to it.
        expect(sm.isTerminal(s)).toBe(false);
        expect(sm.getAllowedTransitions(s)).toEqual([OrderStatus.PENDING_CONFIRMATION]);
        expect(sm.requiredSideEffects(s, OrderStatus.PENDING_CONFIRMATION)).toEqual([]);
      },
    );

    it.each([OrderStatus.CALL_NO_RESPONSE, OrderStatus.CALL_RESCHEDULED])(
      '%s has an EXPLICIT self-loop (same state, attempt logged), no side-effects',
      (s) => {
        expect(sm.isValidTransition(s, s)).toBe(true);
        expect(sm.requiredSideEffects(s, s)).toEqual([]);
      },
    );
  });

  describe('Module 8 warehouse edges (WMS-4 pick shortfall)', () => {
    it('PENDING_PICK → PENDING_MANUAL_PLACEMENT is valid with NO side-effects (M5 conservation keeps the residual phase-1 reservation)', () => {
      expect(
        sm.isValidTransition(OrderStatus.PENDING_PICK, OrderStatus.PENDING_MANUAL_PLACEMENT),
      ).toBe(true);
      expect(
        sm.requiredSideEffects(OrderStatus.PENDING_PICK, OrderStatus.PENDING_MANUAL_PLACEMENT),
      ).toEqual([]);
    });

    it('the supervisor can route PENDING_MANUAL_PLACEMENT back to PENDING_PICK (re-pick)', () => {
      expect(
        sm.isValidTransition(OrderStatus.PENDING_MANUAL_PLACEMENT, OrderStatus.PENDING_PICK),
      ).toBe(true);
    });

    it('PENDING_MANUAL_PLACEMENT → DISPATCHED is valid and STOCK-NEUTRAL (Model C — every ON_SHELF path already passed through PACKED)', () => {
      expect(
        sm.isValidTransition(OrderStatus.PENDING_MANUAL_PLACEMENT, OrderStatus.DISPATCHED),
      ).toBe(true);
      expect(
        sm.requiredSideEffects(OrderStatus.PENDING_MANUAL_PLACEMENT, OrderStatus.DISPATCHED),
      ).toEqual([]);
    });
  });

  describe('invalid transitions', () => {
    it.each([
      [OrderStatus.DRAFT, OrderStatus.CONFIRMED], // must submit first
      [OrderStatus.DRAFT, OrderStatus.DELIVERED],
      [OrderStatus.PENDING_CONFIRMATION, OrderStatus.PENDING_PICK], // must confirm first
      [OrderStatus.CONFIRMED, OrderStatus.DRAFT], // no going back
      // Still refused: a delivered order may go BACK (RTO_INITIATED),
      // not forward to an earlier stage.
      [OrderStatus.DELIVERED, OrderStatus.CONFIRMED],
      [OrderStatus.CANCELLED, OrderStatus.CONFIRMED], // terminal
      [OrderStatus.CONFIRMED, OrderStatus.CONFIRMED], // no self-loop
    ])('%s → %s is rejected', (from, to) => {
      expect(sm.isValidTransition(from, to)).toBe(false);
      expect(() => sm.requiredSideEffects(from, to)).toThrow(/Invalid order transition/);
    });

    it('every terminal state has zero allowed transitions', () => {
      for (const s of TERMINAL) {
        expect(sm.getAllowedTransitions(s)).toEqual([]);
      }
    });
  });

  it('getAllowedTransitions returns the declared targets', () => {
    expect(new Set(sm.getAllowedTransitions(OrderStatus.OUT_OF_STOCK))).toEqual(
      new Set([
        OrderStatus.CONFIRMED,
        OrderStatus.PENDING_CONFIRMATION,
        OrderStatus.CANCELLED,
        OrderStatus.CANCELLED_BY_ADMIN,
      ]),
    );
  });
});
