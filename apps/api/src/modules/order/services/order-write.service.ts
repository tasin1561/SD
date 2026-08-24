import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderCancellationReason,
  OrderStatus,
  PackBoxStatus,
  Prisma,
  QueueClosureReason,
  ReservationReleaseReason,
  ShipmentStatus,
  StockMovementType,
  SellerCapability,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import {
  InsufficientStockError,
  StockReservationService,
} from '../../inventory-stock/services/stock-reservation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import { ShipmentProvisionService } from '../../shipment-provision/services/shipment-provision.service';
import { OrderLifecycleEventBus } from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { OrderChargesRefundService } from '../../seller-wallet-accrual/services/order-charges-refund.service';
import { OrderEventWriterService, type EventActor } from './order-event-writer.service';
import { OrderSideEffect, OrderStateMachineService } from './order-state-machine.service';

const DEFAULT_WAREHOUSE_SETTING_KEY = 'ops.default_warehouse_id';

const CANCEL_FAMILY: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
]);

/** M8 commit 16: the set of "deliberately ending the order" landings
 *  on which the shipment-provision wiring (R3) should void a CREATED
 *  shipment. voidForOrder is idempotent against non-CREATED shipments,
 *  so this list is intentionally generous — post-pick/pack/dispatch
 *  shipments are no longer CREATED and are naturally untouched. */
const VOIDABLE_TERMINAL_STATES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
  OrderStatus.REJECTED_BY_CUSTOMER,
  OrderStatus.REJECTED_NDR,
]);

/**
 * States an order can be called off from and honestly say the parcel
 * never went anywhere — so a delivery fee already taken has to go back.
 *
 * An ALLOW-LIST rather than "everything before DISPATCHED", so a status
 * added later is not silently refundable: someone has to decide where
 * it sits relative to the courier having the parcel. The dividing line
 * is exactly that — once DISPATCHED, the courier has been given the
 * goods and the cost of moving them is real whatever happens next.
 * PENDING_DISPATCH is on this side of the line: it is packed and
 * manifested but still on our floor.
 */
const REFUNDABLE_FROM_STATES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DRAFT,
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CALL_NO_RESPONSE,
  OrderStatus.CALL_RESCHEDULED,
  OrderStatus.AWAITING_SELLER_DECISION,
  OrderStatus.CONFIRMED,
  OrderStatus.OUT_OF_STOCK,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACK_FAILED,
  OrderStatus.PACKED,
  OrderStatus.PENDING_DISPATCH,
  OrderStatus.PENDING_MANUAL_PLACEMENT,
]);

/**
 * How far a SELLER may cancel their own order.
 *
 * The rule is "until it is packed": once the parcel is boxed, sealed
 * and labelled it is a physical object waiting for a van, and undoing
 * it is warehouse work rather than a decision the seller can take
 * alone. Admins keep the wider CANCELLED_BY_ADMIN reach for exactly
 * those cases — the matrix is what enforces the difference, and this
 * set only decides which refusal MESSAGE the seller reads.
 */
const SELLER_CANCELLABLE_STATES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DRAFT,
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CALL_NO_RESPONSE,
  OrderStatus.CALL_RESCHEDULED,
  OrderStatus.AWAITING_SELLER_DECISION,
  OrderStatus.CONFIRMED,
  OrderStatus.OUT_OF_STOCK,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACK_FAILED,
  OrderStatus.PENDING_MANUAL_PLACEMENT,
]);

/** Structural shape the shipment-provision hook needs from the loaded
 *  order — kept local + decoupled from the Prisma payload type so the
 *  helper signature reads at the call site. */
interface ProvisionableOrder {
  readonly id: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2: string | null;
  readonly recipientLandmark: string | null;
  readonly recipientCity: string;
  readonly recipientStateProvince: string;
  readonly recipientPostalCode: string;
  readonly recipientCountryCode: string;
  readonly declaredValueInr: Prisma.Decimal;
  readonly codAmountInr: Prisma.Decimal | null;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly quantity: number;
    readonly skuCode: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly unitWeightGrams: number | null;
    readonly unitDeclaredValueInr: Prisma.Decimal | null;
    readonly unitPriceInr: Prisma.Decimal | null;
  }>;
}

export type ReservationOutcome = 'RESERVED' | 'OUT_OF_STOCK' | 'RELEASED' | 'FULFILLED' | null;

export interface TransitionStatusInput {
  orderId: string;
  to: OrderStatus;
  actor: EventActor;
  /** Optimistic guard: if set and != the order's current status → 409. */
  expectedFrom?: OrderStatus;
  /** Human-readable note recorded on the STATUS_CHANGED event. */
  reason?: string;
  /** Required-ish for the cancel family; defaults to OTHER. */
  cancellationReason?: OrderCancellationReason;
  ctx?: ClientContext;
}

export interface TransitionStatusResult {
  orderId: string;
  fromStatus: OrderStatus;
  /** The status actually persisted — may be OUT_OF_STOCK if a reserve
   *  failed on a → CONFIRMED attempt. */
  status: OrderStatus;
  reservationOutcome: ReservationOutcome;
}

/**
 * M11: internal-only extension carrying the per-occurrence statusEventId
 * needed by the post-commit lifecycle-event emit (NOTIF-1). Kept off
 * the public TransitionStatusResult so cross-module consumers (Modules
 * 7, 8, 9, future pricing/shipments) don't ripple-rebuild against an
 * implementation detail of the M11 emit wiring.
 */
interface InternalTransitionResult extends TransitionStatusResult {
  readonly statusEventId: string;
}

/**
 * ORD-1/ORD-3 — the order lifecycle WRITE engine and the sanctioned
 * cross-module write boundary. Modules 7 (call centre) and 8 (warehouse
 * ops) drive every post-DRAFT status change through `transitionStatus()`;
 * they never write `orders.status` directly.
 *
 * ── Transaction boundary (locked decision, user-approved) ──────────────
 * CLAUDE status-change rule #1 wants update + side-effects in ONE
 * `$transaction`. The stock side-effect CANNOT comply: Module 5's
 * `StockReservationService` owns its own version-CAS retry tx (INV-1/
 * INV-6) and exposes no tx-accepting API. So this is a SAGA, not one
 * ACID unit — a deliberate, recorded deviation (see phase-1a-debt):
 *
 *   • RESERVE_STOCK (→ CONFIRMED): reserve() per line BEFORE the status
 *     tx. InsufficientStockError → land OUT_OF_STOCK (its own tx) when
 *     the matrix allows that landing, else surface 409 with no status
 *     change. If the status tx then fails, COMPENSATE by releasing the
 *     reservations just created (release() is idempotent).
 *   • The order DB write + its events + audit are still atomic together.
 *   • RELEASE_STOCK / FULFILL_STOCK: run AFTER tx.commit(), idempotent,
 *     exactly mirroring INV-5 (cache/alert AFTER commit). A post-commit
 *     failure is safe — the order is correctly terminal and M5's TTL +
 *     hourly auto-release worker reclaim any lingering hold.
 *
 * Email enqueue is intentionally NOT wired here — notification dispatch
 * is Module 11; this engine only owns status + stock + events + audit.
 *
 * ── CC-6 call-queue coupling (Module 7) ────────────────────────────────
 * POST-COMMIT, idempotent, best-effort (never undoes a committed status
 * change): a transition whose RESULT status is PENDING_CONFIRMATION
 * re-enqueues the order for a call; leaving PENDING_CONFIRMATION
 * dequeues the OPEN entry. The dequeue is a safe no-op when a
 * CallAttemptService flow already COMPLETED the entry in its own tx —
 * that is the documented "idempotent, safe alongside an in-flight call
 * attempt" property. Via the shared `call-queue` R3 primitive.
 *
 * ── SANCTIONED CROSS-MODULE API (Modules 7 / 8) ────────────────────────
 *
 * transitionStatus({ orderId, to, actor, expectedFrom?, reason?,
 *                     cancellationReason?, ctx? }): TransitionStatusResult
 *   The ONE post-DRAFT status-change entry point (ORD-1/ORD-3). Modules
 *   7/8 NEVER write orders.status directly. Guards: state-machine
 *   validity (409 INVALID_TRANSITION), optimistic `expectedFrom` (409
 *   STALE_ORDER_STATUS), no-op (409 NOOP_TRANSITION) — EXCEPT a
 *   from===to that the matrix explicitly declares as a self-loop
 *   (Module 7 CALL_NO_RESPONSE/CALL_RESCHEDULED repeats), which is a
 *   valid event-writing transition and proceeds; 404. Stock side-effects follow the
 *   SAGA documented on the method JSDoc below: RESERVE pre-tx (failure →
 *   OUT_OF_STOCK when the matrix allows, else 409; tx-failure →
 *   compensating release); RELEASE/FULFILL post-commit & idempotent.
 *   The result's `reservationOutcome` reports
 *   RESERVED|OUT_OF_STOCK|RELEASED|FULFILLED|null and `status` is the
 *   status actually persisted (may be OUT_OF_STOCK on a → CONFIRMED
 *   reserve failure). The order DB write + its events + audit are the
 *   only true ACID unit.
 *
 * God mode (OrderAdminOverrideService) is the ONE sanctioned bypass and
 * is NOT part of this cross-module API.
 * ───────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class OrderWriteService {
  private readonly logger = new Logger(OrderWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictions: SellerRestrictionService,
    private readonly stateMachine: OrderStateMachineService,
    private readonly events: OrderEventWriterService,
    private readonly audit: AuditLogService,
    private readonly reservations: StockReservationService,
    private readonly callQueue: CallQueueService,
    private readonly shipmentProvision: ShipmentProvisionService,
    private readonly mutation: StockMutationService,
    // M11 (NOTIF-5): the order module emits to the R3 dependency-
    // free bus; it has NO awareness of the notifications module. A
    // listener that does not exist (or hasn't subscribed yet) is a
    // SILENT no-op — emit() is best-effort by contract (NOTIF-1).
    private readonly lifecycleBus: OrderLifecycleEventBus,
    // Giving the delivery fee back when an order ends before it ships.
    // An AT_AWB seller is debited at CONFIRMED (CUR-2b), days before
    // anything moves; without this hook a cancellation quietly kept
    // their money and only the seller noticing an odd balance would
    // surface it.
    private readonly chargesRefund: OrderChargesRefundService,
  ) {}

  /**
   * Drive one order status transition + its stock side-effect.
   *
   * ── THE SAGA PATTERN (reusable for M5/M6-style boundary integrations,
   *    e.g. Modules 8/9 courier/warehouse↔stock) ───────────────────────
   * A cross-module side-effect whose owner runs its OWN transaction
   * (here: M5 reservation, version-CAS/INV-1) cannot be enrolled in this
   * service's `$transaction`. Resolve the boundary with a saga, never a
   * distributed/nested tx:
   *
   *   1. PRE-TX, fail-routing side-effect (RESERVE): run the external op
   *      BEFORE the local tx. On its typed failure, route the local
   *      state to a designated non-terminal landing (here: OUT_OF_STOCK)
   *      in its own tx — do not 500.
   *   2. LOCAL TX: the local DB write + its events + audit commit
   *      atomically together (the only true ACID unit).
   *   3. COMPENSATION: if the local tx fails AFTER a successful pre-tx
   *      side-effect, run the external op's idempotent inverse (here:
   *      release()) to undo it. Best-effort; log on failure.
   *   4. POST-COMMIT, idempotent side-effect (RELEASE/FULFILL): run
   *      AFTER `tx.commit()`, idempotent, per target. A post-commit
   *      failure must be SAFE by construction — the local state is
   *      already correct and an out-of-band reconciler (M5 TTL + hourly
   *      auto-release worker) sweeps the residue. Mirrors INV-5.
   *
   * The invariant: the local state is never left lying about a
   * side-effect. Reserve failure → OUT_OF_STOCK (truthful); tx failure →
   * compensated; post-commit failure → terminal state already truthful,
   * reconciler cleans up. God mode (OrderAdminOverrideService) is the
   * ONE sanctioned bypass of this engine and explicitly opts OUT of the
   * compensation guarantee.
   */
  /**
   * Would this transition be allowed? A READ over the same matrix
   * `transitionStatus` enforces.
   *
   * On the write boundary rather than by exporting the state machine,
   * because MUST #16 keeps the order module's cross-module surface to
   * these two services — and "would this write be accepted" is a
   * question about writes. It exists so a caller can offer an action
   * only where it can actually succeed: the re-attempt request filters
   * its settings-driven status list through this, so a list naming a
   * status with no edge is inert rather than producing a button whose
   * approval 409s.
   */
  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return this.stateMachine.isValidTransition(from, to);
  }

  async transitionStatus(input: TransitionStatusInput): Promise<TransitionStatusResult> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        orderNumber: true,
        status: true,
        // M8 commit-16 shipment-provision snapshot fields (recipient
        // block + per-line snapshot; immutable per ORD-6 so pre-tx read
        // is identical to post-tx). Selected here so the post-commit
        // CONFIRMED hook doesn't need a re-load.
        recipientName: true,
        recipientPhoneE164: true,
        recipientAddressLine1: true,
        recipientAddressLine2: true,
        recipientLandmark: true,
        recipientCity: true,
        recipientStateProvince: true,
        recipientPostalCode: true,
        recipientCountryCode: true,
        declaredValueInr: true,
        codAmountInr: true,
        items: {
          select: {
            id: true,
            variantId: true,
            quantity: true,
            skuCode: true,
            productName: true,
            variantLabel: true,
            unitWeightGrams: true,
            unitDeclaredValueInr: true,
            unitPriceInr: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${input.orderId} not found`);
    }

    const from = order.status;
    const { to } = input;

    // A seller on hold does not get stock committed to them.
    //
    // Here rather than at the call-centre screen because every path to
    // CONFIRMED runs through this method (ORD-3) — an agent's outcome, a
    // re-attempt approval, an admin action. The agent sees the refusal
    // mid-call, which is the right moment: the alternative is reserving
    // stock for an account we have already decided to stop.
    //
    // God mode is exempt by construction — it does not come through
    // here (ORD-2).
    if (to === OrderStatus.CONFIRMED && from !== OrderStatus.CONFIRMED) {
      await this.restrictions.assertAllowed(order.sellerId, SellerCapability.ORDER_CONFIRM);
    }

    if (input.expectedFrom !== undefined && input.expectedFrom !== from) {
      throw new ConflictException({
        code: 'STALE_ORDER_STATUS',
        message: `Expected order to be ${input.expectedFrom} but it is ${from}`,
      });
    }
    const isValid = this.stateMachine.isValidTransition(from, to);
    // Matrix-declared self-loops (Module 7: CALL_NO_RESPONSE →
    // CALL_NO_RESPONSE and CALL_RESCHEDULED → CALL_RESCHEDULED) are
    // *valid* event-writing transitions — semantically "same state, a
    // new call attempt was logged" (CC-3). They proceed normally: empty
    // side-effects ⇒ transitionPlain ⇒ a STATUS_CHANGED event + audit
    // (the attempt's order_events trail). A from===to the matrix does
    // NOT declare is still a defensive 409 NOOP_TRANSITION.
    if (from === to && !isValid) {
      throw new ConflictException({
        code: 'NOOP_TRANSITION',
        message: `Order is already ${to}`,
      });
    }
    if (!isValid) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `${from} → ${to} is not a valid order transition`,
      });
    }

    const sideEffects = this.stateMachine.requiredSideEffects(from, to);

    let result: InternalTransitionResult;
    if (sideEffects.includes(OrderSideEffect.RESERVE_STOCK)) {
      result = await this.transitionWithReserve(order, from, to, input);
    } else if (sideEffects.includes(OrderSideEffect.RELEASE_STOCK)) {
      result = await this.transitionThenStock(order, from, to, input, 'RELEASE');
    } else if (sideEffects.includes(OrderSideEffect.DISPATCH_STOCK)) {
      result = await this.transitionWithDispatch(order, from, to, input);
    } else if (sideEffects.includes(OrderSideEffect.FULFILL_STOCK)) {
      // Model A: no matrix edge carries FULFILL_STOCK (DELIVERED is
      // stock-neutral). Branch retained defensively / for god-mode use.
      result = await this.transitionThenStock(order, from, to, input, 'FULFILL');
    } else {
      result = await this.transitionPlain(order, from, to, input);
    }

    // CC-6: a transition INTO PENDING_CONFIRMATION (OUT_OF_STOCK /
    // CALL_NO_RESPONSE / CALL_RESCHEDULED → re-queue) re-joins the call
    // queue. POST-COMMIT, idempotent (existing OPEN entry → no-op),
    // best-effort — never undo a committed status change for this.
    // `result.status` (not `to`) so a reserve-failed → OUT_OF_STOCK
    // landing is NOT mis-enqueued.
    if (result.status === OrderStatus.PENDING_CONFIRMATION) {
      await this.enqueueForCall(order.id, input.ctx);
    } else if (from === OrderStatus.PENDING_CONFIRMATION) {
      // CC-6: leaving PENDING_CONFIRMATION (any non-confirm/confirm exit)
      // closes the OPEN call-queue entry. POST-COMMIT + IDEMPOTENT — when
      // a CallAttemptService flow already COMPLETED the entry in its own
      // tx this is a safe no-op ({dequeued:0}); when transitionStatus is
      // driven directly (admin sane-cancel / god-mode) it does the close.
      await this.dequeueForExit(order.id, result.status, input.ctx);
    }

    // M8 commit 9: pack-queue eligibility hook. The pack queue is a
    // VIRTUAL FIFO query (PackQueueService.pullNext joins on
    // o.status='picked'), so no physical row insert is needed — entry
    // into PICKED makes the shipment pack-eligible by construction.
    // We emit a structured audit entry as the OBSERVABILITY HOOK +
    // future extension point: when packer notification (BullMQ /
    // WebSocket) lands, replace this audit call with the real
    // enqueue/event (mirrors the CC-6 enqueueForCall shape). POST-COMMIT,
    // best-effort, never undoes the committed status change.
    if (result.status === OrderStatus.PICKED && from !== OrderStatus.PICKED) {
      await this.signalPackEligible(order.id, input.ctx);
    }

    // M8 commit 16: shipment-provision wiring (R3 dual-path,
    // mirrors CC-6 enqueueForCall/dequeueForExit).
    //   - On entry to CONFIRMED: provisionFromSnapshot (the R3
    //     primitive — idempotent on an existing non-CANCELLED shipment,
    //     so a retried hook is a {created:false} no-op).
    //   - On entry to a deliberately-ending state (CANCELLED / REJECTED
    //     family): voidForOrder (idempotent — no CREATED shipment ⇒
    //     {voided:0}; post-pick/pack shipments are no longer CREATED
    //     and are naturally untouched).
    // POST-COMMIT, best-effort, NEVER undoes the committed status
    // change — failures here surface as warnings, the next caller's
    // idempotent re-attempt (or out-of-band ops) reconciles.
    if (result.status === OrderStatus.CONFIRMED && from !== OrderStatus.CONFIRMED) {
      await this.provisionShipmentForOrder(order, input.ctx);
    } else if (from !== result.status && VOIDABLE_TERMINAL_STATES.has(result.status)) {
      await this.voidShipmentForOrder(order.id, result.status, input.ctx);
      // 7th post-commit hook: return the delivery fee, if one was
      // already taken, on an order that is ending before the courier
      // ever had it. Runs AFTER the void so the shipment is dead first
      // — the money step is the one whose failure we most want to be
      // loud about, and putting it last means a failure here cannot
      // leave a live shipment behind as well.
      await this.refundChargesForEndedOrder(order.id, order.sellerId, from, result.status);
    }

    // M11 (NOTIF-1 / NOTIF-5): 6th post-commit hook — emit the
    // lifecycle event to the R3 OrderLifecycleEventBus. The
    // notifications module subscribes; the order module knows nothing
    // about it (the bus is the dep-free shared primitive). Three
    // layers of "never block / never rollback":
    //   1. emit() runs AFTER all the prior post-commit hooks AND
    //      after the transition tx committed → the transition is
    //      durable regardless of what the bus does.
    //   2. The bus' emit() itself wraps Subject.next() in try/catch
    //      and never re-throws (NOTIF-1 contract guarantee).
    //   3. We wrap it again here in try/catch for defence-in-depth —
    //      a future bus impl with different semantics (e.g., a
    //      Phase-2 Redis pub/sub) must not be able to leak failures
    //      into the order transition return path either.
    // We use result.status (NOT `to`) so a reserve-failed →
    // OUT_OF_STOCK landing fires its OWN lifecycle event (mapping
    // routes OUT_OF_STOCK to [] anyway, but the emit is the
    // observable record).
    this.emitLifecycleEvent(order.sellerId, result, input);

    // Strip the internal-only statusEventId — public callers see only
    // TransitionStatusResult.
    const { statusEventId: _unused, ...publicResult } = result;
    return publicResult;
  }

  /** M11 6th post-commit hook — best-effort, double-wrapped (the bus
   *  also swallows). NEVER awaited: a synchronous Subject emit is
   *  the contract, and even if a future async listener path is added
   *  it must not block the transition. */
  private emitLifecycleEvent(
    sellerId: string,
    result: InternalTransitionResult,
    input: TransitionStatusInput,
  ): void {
    try {
      this.lifecycleBus.emit({
        orderId: result.orderId,
        sellerId,
        from: result.fromStatus,
        to: result.status,
        statusEventId: result.statusEventId,
        actorType: input.actor.type,
        actorId: input.actor.id ?? null,
        occurredAt: new Date(),
      });
    } catch (err) {
      // The bus contracts NEVER to re-throw, but defensively swallow
      // any path that might (e.g., a future bus impl swap-in).
      this.logger.error(
        {
          orderId: result.orderId,
          from: result.fromStatus,
          to: result.status,
          statusEventId: result.statusEventId,
          err: (err as Error).message,
        },
        'Lifecycle-event emit threw despite bus contract; swallowed (NOTIF-1)',
      );
    }
  }

  /** M8 pack-eligibility hook — audit-only for Phase 1A. Best-effort:
   *  a failure here NEVER undoes the committed PICKED transition. */
  private async signalPackEligible(orderId: string, ctx?: ClientContext): Promise<void> {
    try {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: 'pack_queue.eligible',
        entityType: 'order',
        entityId: orderId,
        severity: 'LOW',
        metadata: {
          orderId,
          ipAddress: ctx?.ipAddress ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
        },
      });
    } catch (e) {
      this.logger.error(
        { orderId, err: (e as Error).message },
        'Post-commit pack-eligibility signal failed; status persisted',
      );
    }
  }

  /** M8 commit 16: shipment-provision wiring on entry to CONFIRMED.
   *  POST-COMMIT, best-effort, idempotent on existing non-CANCELLED
   *  shipments (CC-6 dual-path — a retried hook is a {created:false}
   *  no-op). The snapshot is built from the order we already loaded
   *  (recipient + items immutable per ORD-6). */
  private async provisionShipmentForOrder(
    order: ProvisionableOrder,
    ctx?: ClientContext,
  ): Promise<void> {
    try {
      await this.shipmentProvision.provisionFromSnapshot(
        {
          orderId: order.id,
          recipient: {
            name: order.recipientName,
            phoneE164: order.recipientPhoneE164,
            addressLine1: order.recipientAddressLine1,
            addressLine2: order.recipientAddressLine2,
            landmark: order.recipientLandmark,
            city: order.recipientCity,
            stateProvince: order.recipientStateProvince,
            postalCode: order.recipientPostalCode,
            countryCode: order.recipientCountryCode,
          },
          declaredValueInr: order.declaredValueInr,
          codAmountInr: order.codAmountInr,
          items: order.items.map((i) => ({
            orderItemId: i.id,
            quantity: i.quantity,
            skuCode: i.skuCode,
            productName: i.productName,
            variantLabel: i.variantLabel,
            unitWeightGrams: i.unitWeightGrams,
            unitDeclaredValueInr: i.unitDeclaredValueInr,
            unitPriceInr: i.unitPriceInr,
          })),
        },
        { type: ActorType.SYSTEM, id: null },
        ctx,
      );
    } catch (e) {
      this.logger.error(
        { orderId: order.id, err: (e as Error).message },
        'Post-commit shipment provision failed; order CONFIRMED persisted, supervisor/reconciler can re-trigger via OrderAdminOverrideService or a follow-up CONFIRMED→CONFIRMED matrix self-loop',
      );
    }
  }

  /** M8 commit 16: shipment-void wiring on entry to a deliberately
   *  ending state. POST-COMMIT, best-effort, idempotent (no CREATED
   *  shipment ⇒ {voided:0}). Cancellation reason is carried as the
   *  destination status. */
  private async voidShipmentForOrder(
    orderId: string,
    landed: OrderStatus,
    ctx?: ClientContext,
  ): Promise<void> {
    try {
      await this.shipmentProvision.voidForOrder(
        orderId,
        `Order transitioned to ${landed}`,
        { type: ActorType.SYSTEM, id: null },
        ctx,
      );
    } catch (e) {
      this.logger.error(
        { orderId, landed, err: (e as Error).message },
        'Post-commit shipment void failed; order status persisted, supervisor/reconciler can re-trigger',
      );
    }
  }

  /**
   * A seller calling off their own order.
   *
   * ── Why this lives on the WRITE boundary ──────────────────────────
   * It used to be `OrderService.cancel`, which refused anything with a
   * stock side-effect (`CANCEL_NEEDS_STOCK_RELEASE`) and wrote the
   * order row itself. That made a seller's cancel button work only on
   * orders nobody had acted on yet — the moment a call agent confirmed
   * it, the seller had to email us. It also meant a cancelled
   * PENDING_CONFIRMATION order was never REMOVED FROM THE CALL QUEUE,
   * because the CC-6 dequeue hangs off `transitionStatus` and that path
   * went around it: an agent would be handed a dead order to phone.
   *
   * Routing every seller cancel through `transitionStatus` fixes both
   * at once and costs nothing — the matrix already knew which states
   * release stock, and the saga already knew how.
   *
   * The window closes at PACKED (see SELLER_CANCELLABLE_STATES). What
   * the matrix cannot express is the packer standing at the bench right
   * now with the box open, so that check is here.
   */
  async cancelBySeller(input: {
    readonly sellerId: string;
    readonly orderId: string;
    readonly actor: EventActor;
    readonly cancellationReason?: OrderCancellationReason;
    readonly note?: string;
    readonly ctx?: ClientContext;
  }): Promise<TransitionStatusResult> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: input.orderId, sellerId: input.sellerId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }

    if (CANCEL_FAMILY.has(order.status)) {
      throw new ConflictException({
        code: 'ALREADY_CANCELLED',
        message: 'This order is already cancelled',
      });
    }

    if (!SELLER_CANCELLABLE_STATES.has(order.status)) {
      // Say WHICH side of the line they are on. "Cannot be cancelled"
      // on a packed parcel reads as a bug; "it is already packed" reads
      // as a fact they can act on by calling us.
      const packedOrLater =
        order.status === OrderStatus.PACKED ||
        order.status === OrderStatus.PENDING_DISPATCH ||
        order.status === OrderStatus.DISPATCHED ||
        order.status === OrderStatus.IN_TRANSIT ||
        order.status === OrderStatus.OUT_FOR_DELIVERY;
      throw new ConflictException({
        code: 'NOT_CANCELLABLE',
        message: packedOrLater
          ? 'This order is already packed and can no longer be cancelled here — contact support if it has not yet been collected'
          : `An order in ${order.status} cannot be cancelled`,
      });
    }

    // PACK-1: the open box IS a packer's claim on this parcel. Without
    // this check the cancel would succeed and the packer would discover
    // it only when their close scan failed, mid-shift, with the goods
    // already in the box.
    const openBox = await this.prisma.client.packBox.findFirst({
      where: {
        status: PackBoxStatus.OPEN,
        shipment: { orderShipments: { some: { orderId: order.id } } },
      },
      select: { id: true },
    });
    if (openBox) {
      throw new ConflictException({
        code: 'ORDER_BEING_PACKED',
        message:
          'Someone is packing this order right now. Try again in a few minutes, or contact support to stop it.',
      });
    }

    return this.transitionStatus({
      orderId: order.id,
      to: OrderStatus.CANCELLED,
      actor: input.actor,
      cancellationReason: input.cancellationReason ?? OrderCancellationReason.SELLER_REQUESTED,
      reason: input.note ?? 'Cancelled by seller',
      ...(input.ctx ? { ctx: input.ctx } : {}),
    });
  }

  /**
   * Post-commit: give back a delivery fee taken for a parcel that will
   * now never ship.
   *
   * Best-effort in the sense that it cannot undo the cancellation —
   * that is already committed and correct. But it is NOT best-effort in
   * the sense of "quietly give up": a failure here means we are holding
   * money for a service we are not going to perform, so it audits HIGH
   * and names the order. The service itself is idempotent on the order,
   * so re-running it is always safe and an operator re-triggering after
   * a fault cannot double-credit.
   */
  private async refundChargesForEndedOrder(
    orderId: string,
    sellerId: string,
    from: OrderStatus,
    landed: OrderStatus,
  ): Promise<void> {
    // Cancelling a DISPATCHED order is a real thing an admin can do,
    // but the courier already has the parcel — the delivery is being
    // paid for whatever happens to it now.
    if (!REFUNDABLE_FROM_STATES.has(from)) return;
    try {
      await this.chargesRefund.refundIfCharged(
        orderId,
        sellerId,
        `Order ${landed.toLowerCase().replaceAll('_', ' ')} before dispatch`,
      );
    } catch (e) {
      this.logger.error(
        { orderId, sellerId, from, landed, err: (e as Error).message },
        'Post-commit order-charges refund FAILED — the seller is still holding a charge for a parcel that will not ship',
      );
      await this.audit
        .log({
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId,
          action: 'wallet.order_charges_refund_failed',
          entityType: 'order',
          entityId: orderId,
          severity: 'HIGH',
          metadata: { fromStatus: from, landedStatus: landed, error: (e as Error).message },
        })
        .catch(() => undefined);
    }
  }

  /** CC-6 post-commit call-queue dequeue (idempotent, best-effort). */
  private async dequeueForExit(
    orderId: string,
    landed: OrderStatus,
    ctx?: ClientContext,
  ): Promise<void> {
    try {
      await this.callQueue.dequeueOrder(orderId, this.closureReasonFor(landed), ctx);
    } catch (e) {
      this.logger.error(
        { orderId, landed, err: (e as Error).message },
        'Post-commit call-queue dequeue failed; status persisted, entry self-heals on next dequeue',
      );
    }
  }

  /** Best-effort closure reason for the entry being closed on
   *  PENDING_CONFIRMATION exit. OUT_OF_STOCK (and any other transient
   *  non-terminal landing) has no precise QueueClosureReason value — it
   *  re-enqueues on return to PENDING_CONFIRMATION; ADMIN_CLOSED is the
   *  neutral system-closed fallback (debt-tracked imprecision, final
   *  stretch). */
  private closureReasonFor(landed: OrderStatus): QueueClosureReason {
    switch (landed) {
      case OrderStatus.CONFIRMED:
        return QueueClosureReason.ORDER_CONFIRMED;
      case OrderStatus.CANCELLED:
      case OrderStatus.CANCELLED_BY_ADMIN:
        return QueueClosureReason.ORDER_CANCELLED;
      case OrderStatus.REJECTED:
      case OrderStatus.REJECTED_BY_CUSTOMER:
        return QueueClosureReason.ORDER_REJECTED;
      case OrderStatus.REJECTED_NDR:
        return QueueClosureReason.MAX_ATTEMPTS_EXCEEDED;
      default:
        return QueueClosureReason.ADMIN_CLOSED;
    }
  }

  /** CC-6 post-commit call-queue enqueue (idempotent, best-effort —
   *  mirrors the saga's post-commit discipline). */
  private async enqueueForCall(orderId: string, ctx?: ClientContext): Promise<void> {
    try {
      await this.callQueue.enqueueOrder(orderId, ctx);
    } catch (e) {
      this.logger.error(
        { orderId, err: (e as Error).message },
        'Post-commit call-queue enqueue failed; status persisted, needs re-enqueue',
      );
    }
  }

  // ── RESERVE_STOCK: reserve PRE-tx, compensate on tx failure ──────────

  private async transitionWithReserve(
    order: {
      id: string;
      sellerId: string;
      orderNumber: string;
      items: Array<{ id: string; variantId: string; quantity: number }>;
    },
    from: OrderStatus,
    to: OrderStatus,
    input: TransitionStatusInput,
  ): Promise<InternalTransitionResult> {
    const warehouseId = await this.resolveDefaultWarehouseId();
    const createdReservationIds: string[] = [];

    try {
      for (const item of order.items) {
        const r = await this.reservations.reserve({
          sellerId: order.sellerId,
          variantId: item.variantId,
          warehouseId,
          qtyToReserve: item.quantity,
          orderId: order.id,
          orderItemId: item.id,
        });
        createdReservationIds.push(r.id);
      }
    } catch (e) {
      if (e instanceof InsufficientStockError) {
        // Roll back the partial reservations from THIS attempt.
        await this.bestEffortRelease(
          createdReservationIds,
          ReservationReleaseReason.OTHER,
          input.actor,
        );
        // Land OUT_OF_STOCK only if the matrix allows it from `from`;
        // otherwise leave the status untouched and surface the 409 (the
        // caller — Module 7 — owns retry/escalation).
        if (this.stateMachine.isValidTransition(from, OrderStatus.OUT_OF_STOCK)) {
          const { statusEventId } = await this.writeStatusTx(
            order,
            from,
            OrderStatus.OUT_OF_STOCK,
            input,
            {
              eventDescription: 'Reservation failed at confirm — out of stock',
              auditAction: 'order.out_of_stock',
            },
          );
          return {
            orderId: order.id,
            fromStatus: from,
            status: OrderStatus.OUT_OF_STOCK,
            reservationOutcome: 'OUT_OF_STOCK',
            statusEventId,
          };
        }
      }
      throw e;
    }

    let statusEventId: string;
    try {
      ({ statusEventId } = await this.writeStatusTx(order, from, to, input, {
        eventDescription: input.reason ?? `Status ${from} → ${to}`,
        auditAction: 'order.status_changed',
        stockEvent: { kind: 'RESERVED', reservationIds: createdReservationIds },
      }));
    } catch (e) {
      // Status tx failed AFTER reservations committed → compensate.
      this.logger.error(
        { orderId: order.id, reservationIds: createdReservationIds, err: (e as Error).message },
        'Status tx failed after reserve; compensating with release',
      );
      await this.bestEffortRelease(
        createdReservationIds,
        ReservationReleaseReason.OTHER,
        input.actor,
      );
      throw e;
    }

    return {
      orderId: order.id,
      fromStatus: from,
      status: to,
      reservationOutcome: 'RESERVED',
      statusEventId,
    };
  }

  // ── RELEASE / FULFILL: status tx FIRST, stock AFTER commit ───────────

  private async transitionThenStock(
    order: { id: string; sellerId: string; orderNumber: string; items: unknown[] },
    from: OrderStatus,
    to: OrderStatus,
    input: TransitionStatusInput,
    mode: 'RELEASE' | 'FULFILL',
  ): Promise<InternalTransitionResult> {
    const { statusEventId } = await this.writeStatusTx(order, from, to, input, {
      eventDescription: input.reason ?? `Status ${from} → ${to}`,
      auditAction: 'order.status_changed',
    });

    // POST-COMMIT, idempotent (INV-5 analogue). Failures are logged, not
    // thrown — the order is already correctly terminal and M5's TTL +
    // auto-release worker reclaim any lingering hold.
    const active = await this.reservations.listActiveForOrder(order.id);
    let outcome: ReservationOutcome = mode === 'RELEASE' ? 'RELEASED' : 'FULFILLED';
    const releaseReason =
      to === OrderStatus.REJECTED
        ? ReservationReleaseReason.ORDER_REJECTED_BY_COURIER
        : ReservationReleaseReason.ORDER_CANCELLED;

    for (const r of active) {
      try {
        if (mode === 'RELEASE') {
          await this.reservations.release(r.id, releaseReason, input.actor);
        } else {
          await this.reservations.fulfill(r.id, input.actor);
        }
      } catch (err) {
        outcome = null;
        this.logger.error(
          { orderId: order.id, reservationId: r.id, mode, err: (err as Error).message },
          'Post-commit reservation settle failed; TTL/worker will reconcile',
        );
      }
    }
    if (active.length === 0) outcome = null;

    return {
      orderId: order.id,
      fromStatus: from,
      status: to,
      reservationOutcome: outcome,
      statusEventId,
    };
  }

  // ── DISPATCH_STOCK (Module 9, Model A — the bug-1 fix): the ONE
  //    normal-lifecycle qtyOnHand decrement, PENDING_DISPATCH →
  //    DISPATCHED. ──────────────────────────────────────────────────
  //
  // SAGA, visible-vs-silent failure ordering (same shape as WMS-8):
  //   1. GATE (shipment-grained): a prior DISPATCH movement for this
  //      shipment ⇒ movements already applied — skip (retry-safe, no
  //      double-decrement). stock_movements has no native dedup key;
  //      the existence query IS the gate.
  //   2. PRE-TX: one runWithRetry block issues a DISPATCH StockMovement
  //      (qtyOnHand −= qty) per PHASE-2 reservation (bin+batch from
  //      listActiveForOrderWithLocations; phase-1 residuals — null
  //      bin/batch — skipped). The durable physical fact goes FIRST.
  //   3. LOCAL TX: the authoritative DISPATCHED transition (writeStatusTx).
  //   4. POST-COMMIT: fulfill() per ACTIVE reservation — marks FULFILLED
  //      + clamped qtyReserved give-back (INV-4); idempotent on
  //      already-FULFILLED.
  //
  // Crash after step 2 / before step 3 → order stays PENDING_DISPATCH,
  // qtyOnHand correctly decremented (visible, recoverable); the retry's
  // gate skips re-application and re-runs the transition. Crash inside
  // step 2 → runWithRetry's tx rolls back atomically.
  private async transitionWithDispatch(
    order: { id: string; sellerId: string; orderNumber: string; items: unknown[] },
    from: OrderStatus,
    to: OrderStatus,
    input: TransitionStatusInput,
  ): Promise<InternalTransitionResult> {
    // Resolve the order's LIVE shipment (Phase 1A: one shipment per
    // order; CANCELLED / FAILED_AT_CREATION — e.g. a superseded parcel —
    // excluded). The DISPATCH movements + the gate are keyed on it.
    const liveOrderShipment = await this.prisma.client.orderShipment.findFirst({
      where: {
        orderId: order.id,
        shipment: {
          status: {
            notIn: [ShipmentStatus.CANCELLED, ShipmentStatus.FAILED_AT_CREATION],
          },
          deletedAt: null,
        },
      },
      orderBy: { shipmentSequence: 'desc' },
      select: { shipmentId: true },
    });
    const shipmentId = liveOrderShipment?.shipmentId ?? null;
    if (shipmentId === null) {
      this.logger.warn(
        { orderId: order.id },
        'DISPATCH_STOCK: order has no live shipment — movements will not be shipment-grained',
      );
    }

    // 1. GATE — shipment-grained existence query (orderId fallback only
    //    in the no-live-shipment anomaly).
    const existingDispatch = await this.prisma.client.stockMovement.findFirst({
      where: {
        type: StockMovementType.DISPATCH,
        ...(shipmentId !== null ? { shipmentId } : { orderId: order.id }),
      },
      select: { id: true },
    });
    const movementsAlreadyApplied = existingDispatch !== null;

    // 2. PRE-TX — DISPATCH movements per phase-2 reservation.
    const locations = await this.reservations.listActiveForOrderWithLocations(order.id);
    const phase2 = locations.filter((r) => r.binId !== null && r.batchId !== null);
    if (!movementsAlreadyApplied && phase2.length > 0) {
      await this.mutation.runWithRetry(async (tx) => {
        for (const r of phase2) {
          const binId = r.binId;
          const batchId = r.batchId;
          if (binId === null || batchId === null) continue; // narrowing
          await this.mutation.apply(tx, {
            sellerId: r.sellerId,
            variantId: r.variantId,
            warehouseId: r.warehouseId,
            binId,
            batchId,
            qtyChange: -r.qtyReserved, // the ONE lifecycle decrement
            type: StockMovementType.DISPATCH,
            actorType: input.actor.type,
            actorId: input.actor.id ?? null,
            // DISPATCH self-describes — INV-7 requires reasonCode only
            // for ADJUSTMENT_* / CYCLE_COUNT_ADJUST / EXPIRY_WRITE_OFF.
            reasonCode: null,
            orderId: order.id,
            orderItemId: r.orderItemId,
            shipmentId,
          });
        }
      });
    }

    // 3. LOCAL TX — the authoritative transition.
    const { statusEventId } = await this.writeStatusTx(order, from, to, input, {
      eventDescription: input.reason ?? `Status ${from} → ${to}`,
      auditAction: 'order.status_changed',
    });

    // 4. POST-COMMIT — fulfill() per ACTIVE reservation, idempotent.
    const active = await this.reservations.listActiveForOrder(order.id);
    let outcome: ReservationOutcome = 'FULFILLED';
    for (const r of active) {
      try {
        await this.reservations.fulfill(r.id, input.actor);
      } catch (err) {
        outcome = null;
        this.logger.error(
          { orderId: order.id, reservationId: r.id, err: (err as Error).message },
          'Post-commit dispatch fulfill failed; TTL/worker will reconcile',
        );
      }
    }
    if (active.length === 0) outcome = null;

    return {
      orderId: order.id,
      fromStatus: from,
      status: to,
      reservationOutcome: outcome,
      statusEventId,
    };
  }

  private async transitionPlain(
    order: { id: string; sellerId: string; orderNumber: string; items: unknown[] },
    from: OrderStatus,
    to: OrderStatus,
    input: TransitionStatusInput,
  ): Promise<InternalTransitionResult> {
    const { statusEventId } = await this.writeStatusTx(order, from, to, input, {
      eventDescription: input.reason ?? `Status ${from} → ${to}`,
      auditAction: 'order.status_changed',
    });
    return {
      orderId: order.id,
      fromStatus: from,
      status: to,
      reservationOutcome: null,
      statusEventId,
    };
  }

  // ── the atomic order DB unit (status + events + audit) ───────────────

  private async writeStatusTx(
    order: { id: string; sellerId: string; orderNumber: string },
    from: OrderStatus,
    to: OrderStatus,
    input: TransitionStatusInput,
    opts: {
      eventDescription: string;
      auditAction: string;
      stockEvent?: { kind: 'RESERVED'; reservationIds: string[] };
    },
  ): Promise<{ statusEventId: string }> {
    const now = new Date();
    const isStaff = input.actor.type === ActorType.STAFF;
    // Captured INSIDE the tx and returned to the caller — used by the
    // M11 post-commit lifecycle-event emit (commit 7) as the unique
    // per-occurrence dedup anchor (OrderEvent.id is a uuidv7 generated
    // per STATUS_CHANGED row; the NDR retry cycle DELIVERY_FAILED →
    // OFD → DELIVERY_FAILED produces three distinct ids — both NDR
    // occurrences fan out as distinct notification rounds).
    let capturedStatusEventId: string | null = null;
    await this.prisma.client.$transaction(async (tx) => {
      const staffConnect = isStaff && input.actor.id ? { connect: { id: input.actor.id } } : null;
      const data: Prisma.OrderUpdateInput = { status: to };
      if (to === OrderStatus.CONFIRMED) {
        data.confirmedAt = now;
        if (staffConnect) data.confirmedBy = staffConnect;
      }
      if (CANCEL_FAMILY.has(to)) {
        data.cancellationReason = input.cancellationReason ?? OrderCancellationReason.OTHER;
        data.cancelledAt = now;
        if (staffConnect) data.cancelledBy = staffConnect;
      }
      await tx.order.update({ where: { id: order.id }, data });

      const statusEvent = await this.events.statusChanged(tx, {
        orderId: order.id,
        from,
        to,
        actor: input.actor,
        description: opts.eventDescription,
      });
      capturedStatusEventId = statusEvent.id;
      if (opts.stockEvent?.kind === 'RESERVED') {
        await this.events.stockReserved(tx, order.id, input.actor, {
          reservationIds: opts.stockEvent.reservationIds,
        });
      }

      await this.audit.log(
        {
          actorType: input.actor.type,
          actorId: input.actor.id ?? null,
          sellerId: order.sellerId,
          action: opts.auditAction,
          entityType: 'order',
          entityId: order.id,
          metadata: {
            orderNumber: order.orderNumber,
            fromStatus: from,
            toStatus: to,
            reason: input.reason ?? null,
            ipAddress: input.ctx?.ipAddress ?? null,
            userAgent: input.ctx?.userAgent ?? null,
            requestId: input.ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });
    // INVARIANT: capturedStatusEventId is set by the events.statusChanged
    // call above which always runs inside the tx and which Prisma will
    // not allow to resolve to undefined (uuidv7 is dbgenerated, NOT
    // NULL). If we somehow reach this point with a null, the tx
    // must have committed an incomplete write — refuse to continue.
    if (capturedStatusEventId === null) {
      throw new InternalServerErrorException(
        'writeStatusTx: STATUS_CHANGED event id was not captured',
      );
    }
    return { statusEventId: capturedStatusEventId };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async bestEffortRelease(
    reservationIds: string[],
    reason: ReservationReleaseReason,
    actor: EventActor,
  ): Promise<void> {
    for (const id of reservationIds) {
      try {
        await this.reservations.release(id, reason, actor);
      } catch (err) {
        this.logger.error(
          { reservationId: id, err: (err as Error).message },
          'Compensating release failed; TTL/worker will reconcile',
        );
      }
    }
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    // Config read (system_settings is shared infra, not an inventory
    // domain table) — mirrors AddressValidationService reading
    // ops.allowed_indian_states. Phase 1A is single-warehouse.
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: DEFAULT_WAREHOUSE_SETTING_KEY },
      select: { valueString: true },
    });
    const id = row?.valueString?.trim();
    if (!id) {
      throw new InternalServerErrorException({
        code: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: `${DEFAULT_WAREHOUSE_SETTING_KEY} is not set`,
      });
    }
    return id;
  }
}
