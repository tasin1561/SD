import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';

/**
 * Stock side-effects a transition requires. OrderWriteService (commit 12)
 * executes these inside the status-change transaction (ORD-3). The set is
 * deliberately limited to what Module 6 owns — reservation lifecycle.
 * Physical stock movements for pick/RTO-restock belong to Module 8's
 * StockMutationService and are NOT modelled here; PACK is the one
 * exception, explained on DISPATCH_STOCK below.
 */
export enum OrderSideEffect {
  /** PENDING_CONFIRMATION-family → CONFIRMED: StockReservationService.reserve() per line. */
  RESERVE_STOCK = 'RESERVE_STOCK',
  /** A reserved order → CANCELLED/CANCELLED_BY_ADMIN/REJECTED: release() every active reservation. */
  RELEASE_STOCK = 'RELEASE_STOCK',
  /** → DELIVERED: fulfill() the reservations (clears the hold). NOTE
   *  (Model C): under the pack-time-decrement model this is no longer
   *  attached to any matrix edge — DELIVERED is stock-neutral and the
   *  reservation is FULFILLED at PACK via DISPATCH_STOCK. The value is
   *  retained for the saga handler's `transitionThenStock` 'FULFILL'
   *  path which DISPATCH_STOCK reuses post-commit. */
  FULFILL_STOCK = 'FULFILL_STOCK',
  /**
   * Model C (2026-09-03 — supersedes Model A): PICKED → PACKED.
   *
   * Per phase-2 reservation: a PACK_CONFIRM StockMovement decrements
   * qtyOnHand (the ONE normal-lifecycle physical decrement) AND
   * fulfill() consumes the reservation. Moved here from the
   * PENDING_DISPATCH → DISPATCHED edge, which is now stock-neutral —
   * DISPATCHED means "a driver took it", not "it left the shelf count".
   *
   * The enum member keeps the OLD NAME on purpose: every StockMovement
   * written before this change carries `type: DISPATCH`, and renaming
   * the enum member would make every one of those rows, and every
   * historical reference to "the DISPATCH_STOCK side-effect" in an old
   * commit message or audit row, describe something that no longer
   * exists. The movement TYPE it issues is `PACK_CONFIRM` (new); the
   * SIDE-EFFECT NAME stays `DISPATCH_STOCK` (old) — deliberately, as a
   * pointer to where this used to live.
   */
  DISPATCH_STOCK = 'DISPATCH_STOCK',
  /**
   * Model C's give-back: an order cancelled while its packed parcel is
   * still physically in the building — DISPATCH_STOCK already fired,
   * nothing has been handed to a courier. Reverses every PACK_CONFIRM
   * movement for the shipment (a PACK_REVERSED +qty movement each) and
   * releases any reservation that is still ACTIVE (defensive — by this
   * point it is normally already FULFILLED). Deliberately distinct from
   * RELEASE_STOCK: that one assumes nothing physical has moved yet,
   * which is no longer true once a parcel has been packed.
   */
  UNPACK_STOCK = 'UNPACK_STOCK',
}

interface TransitionDef {
  readonly to: OrderStatus;
  readonly sideEffects: readonly OrderSideEffect[];
}

// Model C: FULFILL_STOCK is no longer attached to any matrix edge —
// DELIVERED is stock-neutral; the reservation is FULFILLED at PACK via
// DISPATCH_STOCK (see its doc comment for why the side-effect keeps its
// old name). The enum member is retained (the OrderWriteService switch
// still has a — now unreachable — branch for it), so it is intentionally
// not destructured here.
const { RESERVE_STOCK, RELEASE_STOCK, DISPATCH_STOCK, UNPACK_STOCK } = OrderSideEffect;

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
  [
    OrderStatus.DRAFT,
    [
      { to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] }, // submit
      { to: OrderStatus.CANCELLED, sideEffects: [] }, // discard a draft
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.PENDING_CONFIRMATION,
    [
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
      // R5b — the at-cap PAUSE for MANUAL_REVIEW sellers (see the status'
      // schema doc). Same inbound set as REJECTED_NDR because it lands at
      // exactly the same moment; only the seller's policy differs.
      { to: OrderStatus.AWAITING_SELLER_DECISION, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.CALL_NO_RESPONSE,
    [
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
      { to: OrderStatus.AWAITING_SELLER_DECISION, sideEffects: [] }, // R5b
    ],
  ],

  [
    OrderStatus.CALL_RESCHEDULED,
    [
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
      { to: OrderStatus.AWAITING_SELLER_DECISION, sideEffects: [] }, // R5b
    ],
  ],

  // A declined order can be re-opened, but ONLY through an approved
  // seller request (OrderReattemptRequestService). The edge exists so
  // the approval has somewhere to go; nothing else in the system uses
  // it, and no seller-facing path reaches it unaided — the customer
  // said no, and a seller who could requeue that alone is a seller who
  // can have somebody rung repeatedly after they refused.
  //
  // Empty side-effects: entry to PENDING_CONFIRMATION re-enqueues for
  // calling through the existing CC-6 post-commit hook, and nothing was
  // reserved to release (ORD-10 — reservation is LATE).
  [OrderStatus.REJECTED_BY_CUSTOMER, [{ to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] }]],

  // REJECTED_NDR has the same single edge, and it is OFF by default.
  //
  // The AWAITING_SELLER_DECISION doc above says this status exists
  // "instead of un-terminaling REJECTED_NDR", because an order that says
  // rejected and is then un-rejected corrupts NDR reporting. That
  // objection stands and is why MANUAL_REVIEW remains the better answer:
  // it asks the seller BEFORE the order is marked rejected, so nothing
  // has to be un-rejected.
  //
  // The edge exists anyway because the choice belongs to whoever runs
  // the operation, not to the schema — but reaching it needs someone to
  // add the status to `orders.reattempt_requestable_statuses`, where the
  // description states this trade. The seeded default names only
  // REJECTED_BY_CUSTOMER.
  [OrderStatus.REJECTED_NDR, [{ to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] }]],

  // R5b — the seller's answer resolves the pause. REQUEST_MORE_ATTEMPTS
  // goes back to PENDING_CONFIRMATION, which re-enqueues the order for
  // calling through the existing CC-6 post-commit hook (no new wiring).
  // RELEASE — and the TTL sweep for a seller who never answers — lands
  // the original terminal. Admin cancels stay available throughout.
  [
    OrderStatus.AWAITING_SELLER_DECISION,
    [
      { to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] },
      { to: OrderStatus.REJECTED_NDR, sideEffects: [] },
      { to: OrderStatus.CANCELLED, sideEffects: [] },
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.OUT_OF_STOCK,
    [
      { to: OrderStatus.CONFIRMED, sideEffects: [RESERVE_STOCK] }, // retry succeeded
      { to: OrderStatus.PENDING_CONFIRMATION, sideEffects: [] }, // re-queue
      { to: OrderStatus.CANCELLED, sideEffects: [] }, // give up — nothing reserved
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.CONFIRMED,
    [
      { to: OrderStatus.PENDING_PICK, sideEffects: [] }, // Module 8 begins
      { to: OrderStatus.PENDING_MANUAL_PLACEMENT, sideEffects: [] },
      { to: OrderStatus.CANCELLED, sideEffects: [RELEASE_STOCK] },
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
      { to: OrderStatus.REJECTED, sideEffects: [RELEASE_STOCK] },
    ],
  ],

  [
    OrderStatus.PENDING_MANUAL_PLACEMENT,
    [
      { to: OrderStatus.PENDING_PICK, sideEffects: [] },
      // Module 9 (commit 14, CUR-8): a MANUAL_PLACEMENT_ADMIN records a
      // manually-arranged courier AWB on the (already picked + packed)
      // shipment and the order dispatches directly. Model C: STOCK-
      // NEUTRAL — every ON_SHELF path here has already passed through
      // PICKED → PACKED (ManualPlacementService.resolveReadiness only
      // returns ON_SHELF once reservations are phase-2, and the ONLY
      // matrix route to phase-2-with-PENDING_MANUAL_PLACEMENT is via
      // PACKED → PENDING_DISPATCH → PENDING_MANUAL_PLACEMENT — a
      // pick-shortfall order is never phase-2 and is routed to
      // PENDING_PICK instead, never reaching this edge). The decrement
      // + fulfill already happened at that PACKED transition.
      { to: OrderStatus.DISPATCHED, sideEffects: [] },
      // PENDING_MANUAL_PLACEMENT is reached via TWO shapes: a pick
      // shortfall (from PENDING_PICK — phase-1 residual, never packed)
      // or a courier rejection (from PENDING_DISPATCH — already packed,
      // qtyOnHand already decremented at PACKED). A cancel here cannot
      // assume which one it is, so it uses UNPACK_STOCK: it reverses
      // whatever PACK_CONFIRM movements actually exist for the shipment
      // (none, for the pick-shortfall shape — a clean no-op) and
      // defensively releases anything still ACTIVE either way. Plain
      // RELEASE_STOCK would silently leak the decrement in the
      // already-packed case.
      { to: OrderStatus.CANCELLED, sideEffects: [UNPACK_STOCK] },
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [UNPACK_STOCK] },
    ],
  ],

  [
    OrderStatus.PENDING_PICK,
    [
      { to: OrderStatus.PICKED, sideEffects: [] },
      // Module 8 (WMS-4): a pick shortfall routes here. NO side-effect —
      // the M5 conservation invariant keeps the residual phase-1
      // reservation intact (allocateAndPopulate/releaseAllocation conserve
      // total reserved qty); a supervisor resolves the manual placement.
      { to: OrderStatus.PENDING_MANUAL_PLACEMENT, sideEffects: [] },
      { to: OrderStatus.CANCELLED, sideEffects: [RELEASE_STOCK] },
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
    ],
  ],

  [
    OrderStatus.PICKED,
    [
      // Model C (2026-09-03): DISPATCH_STOCK decrements qtyOnHand (a
      // PACK_CONFIRM movement) + fulfill()s the phase-2 reservation —
      // moved HERE from PENDING_DISPATCH → DISPATCHED. The goods are
      // boxed and sealed; qtyOnHand now tracks "not on the shelf",
      // which stops being true the moment the box is taped shut, not
      // whenever a courier eventually collects it.
      { to: OrderStatus.PACKED, sideEffects: [DISPATCH_STOCK] },
      // Dormant — nothing calls this transition today (kept correct for
      // when it is wired up, not exercised). If a pack is rejected and
      // re-opened, the decrement above must be undone: UNPACK_STOCK
      // reverses the PACK_CONFIRM movement + releases anything still
      // ACTIVE, so re-picking or re-packing starts from a clean slate
      // rather than double-counting.
      { to: OrderStatus.PACK_FAILED, sideEffects: [UNPACK_STOCK] },
      // Cancellable by the SELLER right up to the moment it is packed.
      // The goods are off the shelf and in a tote, but nothing has been
      // handed to a courier — qtyOnHand has not moved yet, since PACKED
      // is one step ahead of PICKED, so releasing the reservation is the
      // whole of the correction. What it does leave is a physical tote
      // to re-shelve, which is why the packer's open box blocks this at
      // the service layer rather than here.
      { to: OrderStatus.CANCELLED, sideEffects: [RELEASE_STOCK] },
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
    ],
  ],

  [
    OrderStatus.PACK_FAILED,
    [
      { to: OrderStatus.PENDING_PICK, sideEffects: [] }, // re-pick
      { to: OrderStatus.PICKED, sideEffects: [] },
      // A failed pack is still an unpacked parcel, so the seller's
      // cancel window has not closed. Often the right answer: something
      // went wrong at the bench and calling the order off beats
      // re-picking it. Model C: reached ONLY from PACKED (the decrement
      // already happened and was already reversed by UNPACK_STOCK on the
      // way here), so this is plain RELEASE_STOCK — nothing physical is
      // outstanding to reverse a second time.
      { to: OrderStatus.CANCELLED, sideEffects: [RELEASE_STOCK] },
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
    ],
  ],

  [
    OrderStatus.PACKED,
    [
      { to: OrderStatus.PENDING_DISPATCH, sideEffects: [] },
      // Dormant, same as PICKED → PACK_FAILED above. Model C: the parcel
      // is still in the building and qtyOnHand was already decremented
      // at PACKED — reopening it must give that back.
      { to: OrderStatus.PACK_FAILED, sideEffects: [UNPACK_STOCK] }, // re-open
      // The parcel is boxed and sitting in the warehouse, not with a
      // courier. Model C: qtyOnHand already moved at PACKED, so an
      // admin cancel here must GIVE IT BACK — RELEASE_STOCK alone would
      // release an already-FULFILLED reservation (a no-op) and leave the
      // physical decrement unreversed, which is a stock leak.
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [UNPACK_STOCK] },
    ],
  ],

  [
    OrderStatus.PENDING_DISPATCH,
    [
      // Model C: STOCK-NEUTRAL. The decrement + fulfill already happened
      // at PICKED → PACKED (DISPATCH_STOCK moved there) — DISPATCHED now
      // means "a driver took it", which is a real, worth-recording fact
      // on its own, but not a stock event.
      { to: OrderStatus.DISPATCHED, sideEffects: [] },
      { to: OrderStatus.PENDING_MANUAL_PLACEMENT, sideEffects: [] }, // courier rejected
      // Same reasoning as PACKED → CANCELLED_BY_ADMIN above: the parcel
      // is still in the building, qtyOnHand already moved, give it back.
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [UNPACK_STOCK] },
    ],
  ],

  [
    OrderStatus.DISPATCHED,
    [
      { to: OrderStatus.IN_TRANSIT, sideEffects: [] },
      { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
      { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
      { to: OrderStatus.CANCELLED_BY_ADMIN, sideEffects: [RELEASE_STOCK] },
    ],
  ],

  [
    OrderStatus.IN_TRANSIT,
    [
      { to: OrderStatus.OUT_FOR_DELIVERY, sideEffects: [] },
      { to: OrderStatus.DELIVERY_FAILED, sideEffects: [] },
      { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
      { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.OUT_FOR_DELIVERY,
    [
      // Model C: DELIVERED is STOCK-NEUTRAL — qtyOnHand was decremented
      // and the reservation FULFILLED at PACK (DISPATCH_STOCK), two
      // steps before DELIVERED ever runs.
      // FULFILL_STOCK removed from this edge; M10 tracking webhooks never
      // touch stock.
      { to: OrderStatus.DELIVERED, sideEffects: [] },
      { to: OrderStatus.DELIVERY_FAILED, sideEffects: [] },
      { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.DELIVERY_FAILED,
    [
      // The courier rescheduled it and the parcel is moving again.
      //
      // Delhivery resolves most NDRs themselves, on WhatsApp, within
      // minutes: "Consignee Unavailable" at 19:23 was followed by "NTD
      // Updated" and "Agent remark verified" at 19:26, and the parcel
      // went back on their regular panel — it never appeared on their
      // NDR panel at all.
      //
      // Without this edge the order stayed DELIVERY_FAILED while every
      // following transit scan was skipped for having nowhere to go. On
      // a real parcel that was twelve hours of "delivery did not
      // succeed" on a shipment that was already on a van, ending only
      // when an OUT_FOR_DELIVERY scan happened to arrive.
      { to: OrderStatus.IN_TRANSIT, sideEffects: [] },
      { to: OrderStatus.OUT_FOR_DELIVERY, sideEffects: [] }, // retry
      { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
      { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.RTO_INITIATED,
    [
      { to: OrderStatus.RTO_IN_TRANSIT, sideEffects: [] },
      { to: OrderStatus.RTO_RECEIVED, sideEffects: [] },
      { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.RTO_IN_TRANSIT,
    [
      { to: OrderStatus.RTO_RECEIVED, sideEffects: [] },
      { to: OrderStatus.LOST_IN_TRANSIT, sideEffects: [] },
    ],
  ],

  [
    OrderStatus.RTO_RECEIVED,
    [
      { to: OrderStatus.RTO_RESTOCKED, sideEffects: [] }, // physical restock = Module 8
      { to: OrderStatus.RTO_DAMAGED, sideEffects: [] },
    ],
  ],

  // Terminal states — no outgoing transitions in the normal machine.
  // (Admin god-mode bypasses this matrix entirely; LOST→found recovery
  // is a deferred god-mode op per phase-1a-debt.)
  [
    OrderStatus.DELIVERED,
    [
      // The ONE way out of a delivered order: the customer asks to send
      // it back. Distinct from RTO, which starts from a failed delivery
      // and never reached the customer at all — but it rejoins the same
      // path here, because from the warehouse's side a returned parcel
      // is a returned parcel whoever sent it.
      //
      // No side-effects: the goods have not moved yet. Stock comes back
      // at RTO receive, exactly as it does for a courier return.
      { to: OrderStatus.RTO_INITIATED, sideEffects: [] },
    ],
  ],
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
  private readonly graph: ReadonlyMap<
    OrderStatus,
    ReadonlyMap<OrderStatus, readonly OrderSideEffect[]>
  >;

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
