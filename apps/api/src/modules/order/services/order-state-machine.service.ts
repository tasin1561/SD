import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';

/**
 * Stock side-effects a transition requires. OrderWriteService (commit 12)
 * executes these inside the status-change transaction (ORD-3). The set is
 * deliberately limited to what Module 6 owns — reservation lifecycle.
 * Physical stock movements for pick/pack/RTO-restock belong to Module 8's
 * StockMutationService and are NOT modelled here.
 */
export enum OrderSideEffect {
  /** PENDING_CONFIRMATION-family → CONFIRMED: StockReservationService.reserve() per line. */
  RESERVE_STOCK = 'RESERVE_STOCK',
  /** A reserved order → CANCELLED/CANCELLED_BY_ADMIN/REJECTED: release() every active reservation. */
  RELEASE_STOCK = 'RELEASE_STOCK',
  /** → DELIVERED: fulfill() the reservations (clears the hold). NOTE
   *  (Module 9, Model A): under the dispatch-decrement model this is no
   *  longer attached to any matrix edge — DELIVERED is stock-neutral and
   *  the reservation is FULFILLED at DISPATCH via DISPATCH_STOCK. The
   *  value is retained for the saga handler's `transitionThenStock`
   *  'FULFILL' path which DISPATCH_STOCK reuses post-commit. */
  FULFILL_STOCK = 'FULFILL_STOCK',
  /** Module 9 (Model A — the bug-1 fix): PENDING_DISPATCH → DISPATCHED.
   *  Per phase-2 reservation: a DISPATCH StockMovement decrements
   *  qtyOnHand (the ONE normal-lifecycle physical decrement) AND
   *  fulfill() consumes the reservation. DECLARED here in M9 commit 1;
   *  the matrix edge + handler are wired in M9 commit 12 (the atomic
   *  bug-1 fix landing). Unused until then. */
  DISPATCH_STOCK = 'DISPATCH_STOCK',
}

interface TransitionDef {
  readonly to: OrderStatus;
  readonly sideEffects: readonly OrderSideEffect[];
}

const { RESERVE_STOCK, RELEASE_STOCK, FULFILL_STOCK } = OrderSideEffect;

/**
 * Declarative transition table. Each row: from → list of (to, side-effects).
 *
 * Design notes:
 *  - Pre-confirmation cancels (PENDING_CONFIRMATION / CALL_* / OUT_OF_STOCK
 *    → CANCELLED) carry NO RELEASE_STOCK — nothing is reserved yet. This
 *    is the single most important correctness property of the matrix.
 *  - Reservation is created ONLY on entry to CONFIRMED (ORD-10), released
 *    on cancel/reject from any reserved state, fulfilled on DELIVERED.
 *  - The spec's vocabulary maps onto the real enum: PICKING≡PENDING_PICK,
 *    MANIFESTED≡PENDING_DISPATCH; cancel-actor distinction is CANCELLED
 *    (seller/customer, + cancellationReason/cancelledById) vs
 *    CANCELLED_BY_ADMIN (admin sane-cancel + god-mode landing).
 *  - Module 7 owns PENDING_CONFIRMATION→CONFIRMED; Module 8 owns the
 *    warehouse/courier legs; Module 6 only DEFINES the lifecycle and
 *    drives create/submit/confirm/cancel.
 *  - **Explicit self-loops** (Module 7): CALL_NO_RESPONSE→CALL_NO_RESPONSE
 *    and CALL_RESCHEDULED→CALL_RESCHEDULED are *valid* transitions. A
 *    state machine may carry explicit self-loops when "same state,
 *    a new attempt was logged" is the real semantic (repeat NO_ANSWER /
 *    CALLBACK_REQUESTED). Callers that route a self-loop through
 *    OrderWriteService must still bypass its from===to NOOP guard — the
 *    call-center flow does this by treating target===current as
 *    "no status change needed" while still recording the attempt + re-
 *    queueing (Module 7 CC-3).
 */
const TRANSITIONS: ReadonlyArray<readonly [OrderStatus, readonly TransitionDef[]]> = [
  [OrderStatus.DRAFT, [
    { to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] }, // submit
    { to: OrderStatus.CANCELLED, sideEffects: [] }, // discard a draft
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
  ]],

  [OrderStatus.PENDING_CONFIRMATION, [
    { to: OrderStatus.CONFIRMED, sideEffects: [RESERVE_STOCK] }, // Module 7
    { to: OrderStatus.OUT_OF_STOCK, sideEffects: [] }, // reserve() failed at confirm (ORD-10)
    { to: OrderStatus.CALL_NO_RESPONSE, sideEffects: [] },
    { to: OrderStatus.CALL_RESCHEDULED, sideEffects: [] },
    { to: OrderStatus.CANCELLED, sideEffects: [] }, // no reservation yet
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
    { to: OrderStatus.REJECTED, sideEffects: [] },
    // Module 7 call-workflow terminals (pre-reservation → no release).
    { to: OrderStatus.REJECTED_BY_CUSTOMER, sideEffects: [] },
    { to: OrderStatus.REJECTED_NDR, sideEffects: [] },
  ]],

  [OrderStatus.CALL_NO_RESPONSE, [
    { to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] },
    // Self-loop (Module 7): a repeat NO_ANSWER/BUSY/VOICEMAIL_LEFT while
    // already CALL_NO_RESPONSE is "same state, attempt logged" — an
    // EXPLICIT, valid transition (see class JSDoc on self-loops).
    { to: OrderStatus.CALL_NO_RESPONSE, sideEffects: [] },
    { to: OrderStatus.CALL_RESCHEDULED, sideEffects: [] },
    { to: OrderStatus.CONFIRMED, sideEffects: [RESERVE_STOCK] },
    { to: OrderStatus.CANCELLED, sideEffects: [] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
    { to: OrderStatus.REJECTED, sideEffects: [] },
    { to: OrderStatus.REJECTED_BY_CUSTOMER, sideEffects: [] },
    { to: OrderStatus.REJECTED_NDR, sideEffects: [] },
  ]],

  [OrderStatus.CALL_RESCHEDULED, [
    { to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] },
    { to: OrderStatus.CALL_NO_RESPONSE, sideEffects: [] },
    // Self-loop (Module 7): a repeat CALLBACK_REQUESTED re-schedules
    // again — "same state, attempt logged".
    { to: OrderStatus.CALL_RESCHEDULED, sideEffects: [] },
    { to: OrderStatus.CONFIRMED, sideEffects: [RESERVE_STOCK] },
    { to: OrderStatus.CANCELLED, sideEffects: [] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
    { to: OrderStatus.REJECTED, sideEffects: [] },
    { to: OrderStatus.REJECTED_BY_CUSTOMER, sideEffects: [] },
    { to: OrderStatus.REJECTED_NDR, sideEffects: [] },
  ]],

  [OrderStatus.OUT_OF_STOCK, [
    { to: OrderStatus.CONFIRMED, sideEffects: [RESERVE_STOCK] }, // retry succeeded
    { to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] }, // re-queue
    { to: OrderStatus.CANCELLED, sideEffects: [] }, // give up — nothing reserved
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
  ]],

  [OrderStatus.CONFIRMED, [
    { to: OrderStatus.PENDING_PICK, sideEffects: [] }, // Module 8 begins
    { to: OrderStatus.PENDING_MANUAL_PLACEMENT, sideEffects: [] },
    { to: OrderStatus.CANCELLED, sideEffects: [RELEASE_STOCK] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
    { to: OrderStatus.REJECTED, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.PENDING_MANUAL_PLACEMENT, [
    { to: OrderStatus.PENDING_PICK, sideEffects: [] },
    { to: OrderStatus.CANCELLED, sideEffects: [RELEASE_STOCK] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.PENDING_PICK, [
    { to: OrderStatus.PICKED, sideEffects: [] },
    // Module 8 (WMS-4): a pick shortfall routes here. NO side-effect —
    // the M5 conservation invariant keeps the residual phase-1
    // reservation intact (allocateAndPopulate/releaseAllocation conserve
    // total reserved qty); a supervisor resolves the manual placement.
    { to: OrderStatus.PENDING_MANUAL_PLACEMENT, sideEffects: [] },
    { to: OrderStatus.CANCELLED, sideEffects: [RELEASE_STOCK] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.PICKED, [
    { to: OrderStatus.PACKED, sideEffects: [] },
    { to: OrderStatus.PACK_FAILED, sideEffects: [] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.PACK_FAILED, [
    { to: OrderStatus.PENDING_PICK, sideEffects: [] }, // re-pick
    { to: OrderStatus.PICKED, sideEffects: [] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.PACKED, [
    { to: OrderStatus.PENDING_DISPATCH, sideEffects: [] },
    { to: OrderStatus.PACK_FAILED, sideEffects: [] }, // re-open
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.PENDING_DISPATCH, [
    { to: OrderStatus.DISPATCHED, sideEffects: [] },
    { to: OrderStatus.PENDING_MANUAL_PLACEMENT, sideEffects: [] }, // courier rejected
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.DISPATCHED, [
    { to: OrderStatus.IN_TRANSIT, sideEffects: [] },
    { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
    { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
    { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
  ]],

  [OrderStatus.IN_TRANSIT, [
    { to: OrderStatus.OUT_FOR_DELIVERY, sideEffects: [] },
    { to: OrderStatus.DELIVERY_FAILED, sideEffects: [] },
    { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
    { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
  ]],

  [OrderStatus.OUT_FOR_DELIVERY, [
    { to: OrderStatus.DELIVERED, sideEffects: [FULFILL_STOCK] },
    { to: OrderStatus.DELIVERY_FAILED, sideEffects: [] },
    { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
  ]],

  [OrderStatus.DELIVERY_FAILED, [
    { to: OrderStatus.OUT_FOR_DELIVERY, sideEffects: [] }, // retry
    { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
    { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
  ]],

  [OrderStatus.RTO_INITIATED, [
    { to: OrderStatus.RTO_IN_TRANSIT, sideEffects: [] },
    { to: OrderStatus.RTO_RECEIVED, sideEffects: [] },
    { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
  ]],

  [OrderStatus.RTO_IN_TRANSIT, [
    { to: OrderStatus.RTO_RECEIVED, sideEffects: [] },
    { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
  ]],

  [OrderStatus.RTO_RECEIVED, [
    { to: OrderStatus.RTO_RESTOCKED, sideEffects: [] }, // physical restock = Module 8
    { to: OrderStatus.RTO_DAMAGED, sideEffects: [] },
  ]],

  // Terminal states — no outgoing transitions in the normal machine.
  // (Admin god-mode bypasses this matrix entirely; LOST→found recovery
  // is a deferred god-mode op per phase-1a-debt.)
  [OrderStatus.DELIVERED, []],
  [OrderStatus.RTO_RESTOCKED, []],
  [OrderStatus.RTO_DAMAGED, []],
  [OrderStatus.LOST_IN_TRANSIT, []],
  [OrderStatus.CANCELLED, []],
  [OrderStatus.CANCELLED_BY_ADMIN, []],
  [OrderStatus.REJECTED, []],
  [OrderStatus.REJECTED_BY_CUSTOMER, []], // Module 7 terminal
  [OrderStatus.REJECTED_NDR, []], // Module 7 terminal (attempt cap)
];

/**
 * ORD-1 backbone — the order lifecycle state machine. Pure logic, no
 * Prisma. OrderWriteService consults this before every status change and
 * executes the declared side-effects inside the transition transaction.
 */
@Injectable()
export class OrderStateMachineService {
  /** from → (to → side-effects). Built once; exhaustive over OrderStatus. */
  private readonly graph: ReadonlyMap<OrderStatus, ReadonlyMap<OrderStatus, readonly OrderSideEffect[]>>;

  constructor() {
    const graph = new Map<OrderStatus, Map<OrderStatus, readonly OrderSideEffect[]>>();
    // Guarantee every status is a key (terminals → empty map) so lookups
    // never get `undefined` for a real status.
    for (const status of Object.values(OrderStatus)) {
      graph.set(status, new Map());
    }
    for (const [from, defs] of TRANSITIONS) {
      const row = graph.get(from) ?? new Map<OrderStatus, readonly OrderSideEffect[]>();
      for (const def of defs) row.set(def.to, def.sideEffects);
      graph.set(from, row);
    }
    this.graph = graph;
  }

  isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
    return this.graph.get(from)?.has(to) ?? false;
  }

  getAllowedTransitions(from: OrderStatus): OrderStatus[] {
    return [...(this.graph.get(from)?.keys() ?? [])];
  }

  isTerminal(status: OrderStatus): boolean {
    return (this.graph.get(status)?.size ?? 0) === 0;
  }

  /**
   * Side-effects OrderWriteService must run for this transition. Throws on
   * an invalid transition — callers MUST gate with isValidTransition first
   * (OrderWriteService does, surfacing a 409 instead).
   */
  requiredSideEffects(from: OrderStatus, to: OrderStatus): readonly OrderSideEffect[] {
    const effects = this.graph.get(from)?.get(to);
    if (effects === undefined) {
      throw new Error(`Invalid order transition ${from} → ${to}`);
    }
    return effects;
  }
}
