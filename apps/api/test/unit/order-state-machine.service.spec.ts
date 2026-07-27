import { OrderStatus } from '@skydrop/db';
import {
  OrderSideEffect,
  OrderStateMachineService,
} from '../../src/modules/order/services/order-state-machine.service';

const TERMINAL: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
  OrderStatus.LOST_IN_TRANSIT,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
  OrderStatus.REJECTED_BY_CUSTOMER,
  OrderStatus.REJECTED_NDR,
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

    it('PENDING_DISPATCH → DISPATCHED carries DISPATCH_STOCK (M9 Model A — the bug-1 fix)', () => {
      expect(sm.requiredSideEffects(OrderStatus.PENDING_DISPATCH, OrderStatus.DISPATCHED)).toEqual([
        OrderSideEffect.DISPATCH_STOCK,
      ]);
    });

    it('OUT_FOR_DELIVERY → DELIVERED is STOCK-NEUTRAL (M9 Model A — qtyOnHand decremented + fulfilled at DISPATCH)', () => {
      expect(sm.requiredSideEffects(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED)).toEqual(
        [],
      );
    });

    it('a downstream reserved state cancel still releases (PACKED → CANCELLED_BY_ADMIN)', () => {
      expect(sm.requiredSideEffects(OrderStatus.PACKED, OrderStatus.CANCELLED_BY_ADMIN)).toEqual([
        OrderSideEffect.RELEASE_STOCK,
      ]);
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

    it.each([OrderStatus.REJECTED_BY_CUSTOMER, OrderStatus.REJECTED_NDR])('%s is terminal', (s) => {
      expect(sm.isTerminal(s)).toBe(true);
      expect(sm.getAllowedTransitions(s)).toEqual([]);
    });

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

    it('PENDING_MANUAL_PLACEMENT → DISPATCHED is valid and carries DISPATCH_STOCK (M9 commit 14, CUR-8 — manual placement dispatches directly)', () => {
      expect(
        sm.isValidTransition(OrderStatus.PENDING_MANUAL_PLACEMENT, OrderStatus.DISPATCHED),
      ).toBe(true);
      expect(
        sm.requiredSideEffects(OrderStatus.PENDING_MANUAL_PLACEMENT, OrderStatus.DISPATCHED),
      ).toEqual([OrderSideEffect.DISPATCH_STOCK]);
    });
  });

  describe('invalid transitions', () => {
    it.each([
      [OrderStatus.DRAFT, OrderStatus.CONFIRMED], // must submit first
      [OrderStatus.DRAFT, OrderStatus.DELIVERED],
      [OrderStatus.PENDING_CONFIRMATION, OrderStatus.PENDING_PICK], // must confirm first
      [OrderStatus.CONFIRMED, OrderStatus.DRAFT], // no going back
      [OrderStatus.DELIVERED, OrderStatus.CONFIRMED], // terminal
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
