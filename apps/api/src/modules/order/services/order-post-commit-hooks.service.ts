import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  Prisma,
  QueueClosureReason,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import { ShipmentProvisionService } from '../../shipment-provision/services/shipment-provision.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEventSource,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { OrderChargesRefundService } from '../../seller-wallet-accrual/services/order-charges-refund.service';
import { EndedOrderMoneyService } from '../../seller-wallet-accrual/services/ended-order-money.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  ADMIN_OVERRIDE_SOURCE,
  REFUNDABLE_FROM_STATES,
  VOIDABLE_TERMINAL_STATES,
  parcelLeftWithCourier,
} from '../order-carriage';
import type { EventActor } from './order-event-writer.service';

// The carriage rule and the status sets it is drawn from live in a plain
// module shared with the delivery-time money (WAL-8), and are re-exported
// here for the callers that have always imported them from this file.
export {
  ADMIN_OVERRIDE_SOURCE,
  VOIDABLE_TERMINAL_STATES,
  REFUNDABLE_FROM_STATES,
} from '../order-carriage';

/** One open issue per order whose parcel could not be provisioned at
 *  CONFIRMED — raised by the hook, re-checked (and cleared) by the
 *  hourly AWB-less sweep (`OrderAttentionService`). */
export function shipmentMissingIssueKey(orderId: string): string {
  return `shipment-missing:${orderId}`;
}

/** What the shipment-provision hook needs from the order: the recipient
 *  block + per-line snapshot (immutable per ORD-6), marshalled into the
 *  R3 primitive's DTO here rather than resolved by the primitive. */
export const PROVISIONABLE_ORDER_SELECT = {
  id: true,
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
      quantity: true,
      skuCode: true,
      productName: true,
      variantLabel: true,
      unitWeightGrams: true,
      unitDeclaredValueInr: true,
      unitPriceInr: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

/** Structural shape of the snapshot — kept decoupled from the Prisma
 *  payload type so a caller that selected MORE (transitionStatus loads
 *  variantId for the reserve saga) passes its row unchanged. */
export interface ProvisionableOrder {
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

export interface StatusChangeHookInput {
  readonly orderId: string;
  readonly sellerId: string;
  readonly from: OrderStatus;
  /** The status actually persisted (transitionStatus: may be OUT_OF_STOCK
   *  on a reserve-failed → CONFIRMED). */
  readonly landed: OrderStatus;
  /** The committed STATUS_CHANGED row — NOTIF-2's dedup anchor. */
  readonly statusEventId: string;
  readonly actor: EventActor;
  /** Which writer committed it. Decides only how the cancel-time refund
   *  judges "did the parcel leave?" and what the event says; every other
   *  hook depends on where the order LANDED, not on who put it there. */
  readonly source: OrderLifecycleEventSource;
  /** The provisioning snapshot, when the caller already holds it. Absent
   *  ⇒ read post-commit (god mode: a forced edit may have corrected the
   *  recipient in the same call, so the committed row is the truth). */
  readonly snapshot?: ProvisionableOrder;
  readonly ctx?: ClientContext;
}

/**
 * The POST-COMMIT consequences of an order landing somewhere — run
 * identically for BOTH writers of `orders.status`:
 * `OrderWriteService.transitionStatus` (ORD-3) and god mode
 * (`OrderAdminOverrideService.forceMutate`, ORD-2).
 *
 * ── WHY ONE METHOD ────────────────────────────────────────────────────
 * God mode bypasses the MATRIX, not the consequences of where the order
 * lands. Until 2026-09-12 these hooks lived inside transitionStatus and
 * god mode ran none of them, one by one: a forced CONFIRMED had no
 * shipment (unpickable; the AWB listener found nothing to book), a
 * forced cancel left a live shipment behind, and a forced exit from
 * PENDING_CONFIRMATION left the order in the call queue for an agent to
 * ring. Each was patched separately or not at all. One method both
 * writers call is how they stop drifting — a hook added here reaches
 * both, and `order-post-commit-hooks-shared.spec.ts` pins that both call
 * it and neither reaches a hook's collaborator directly.
 *
 * ── STOCK-FREE BY CONSTRUCTION ────────────────────────────────────────
 * This service has no stock collaborator (no StockReservationService, no
 * StockMutationService) and never will: the stock saga (RESERVE /
 * RELEASE / FULFILL / DISPATCH_STOCK / UNPACK_STOCK) stays inside
 * transitionStatus, because god mode deliberately opts OUT of it (ORD-2).
 *
 * ── ORDER (preserved exactly from transitionStatus) ───────────────────
 *   1. CC-6 call queue: enqueue on entry to PENDING_CONFIRMATION, else
 *      dequeue on exit from it.
 *   2. Pack eligibility audit on entry to PICKED.
 *   3. Shipment: provision on entry to CONFIRMED (a failure is RAISED —
 *      `shipment-missing:<orderId>` — and the AWB-less sweep retries it);
 *      or on entry to a cancel/reject terminal, void, THEN give back what
 *      a parcel that never left was charged or credited: retire the
 *      deferred accrual, refund the delivery fee, take back an Instant
 *      Pay credit no courier paid (EndedOrderMoneyService). On entry to
 *      LOST_IN_TRANSIT: refund the fee and retire the accrual (a lost
 *      parcel is not charged, TRE-6).
 *   4. The lifecycle-bus emit, LAST — so the AWB listener (CUR-2b) finds
 *      the shipment step 3 provisioned.
 *
 * Every step is best-effort and ISOLATED: a failure is logged (the
 * refund also audits HIGH) and never propagates — the status change is
 * already committed and is the durable fact (NOTIF-1). All are
 * idempotent, so a re-run converges.
 */
@Injectable()
export class OrderPostCommitHooksService {
  private readonly logger = new Logger(OrderPostCommitHooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly callQueue: CallQueueService,
    private readonly shipmentProvision: ShipmentProvisionService,
    private readonly chargesRefund: OrderChargesRefundService,
    // NOTIF-5: the order module publishes to the R3 bus and knows nothing
    // about who listens.
    private readonly lifecycleBus: OrderLifecycleEventBus,
    // SET-1 — the courier a new parcel is provisioned with is per seller.
    private readonly settings: SettingsResolverService,
    // What else an order ending undelivered gives back (the deferred
    // accrual, an Instant Pay credit no courier paid) — a money
    // collaborator like chargesRefund, not a stock one.
    private readonly endedMoney: EndedOrderMoneyService,
    // A parcel that could not be provisioned is invisible to every queue
    // that selects on a shipment row, so the failure is raised.
    private readonly issues: SystemIssueService,
  ) {}

  async runForStatusChange(input: StatusChangeHookInput): Promise<void> {
    const { orderId, from, landed } = input;

    // 1. CC-6. `landed` (not the requested `to`) so a reserve-failed →
    // OUT_OF_STOCK landing is NOT mis-enqueued. Leaving
    // PENDING_CONFIRMATION closes the OPEN entry — a no-op ({dequeued:0})
    // when a CallAttemptService flow already COMPLETED it in its own tx;
    // the real close for an admin cancel or a god-mode change.
    if (landed === OrderStatus.PENDING_CONFIRMATION) {
      await this.enqueueForCall(orderId, input.ctx);
    } else if (from === OrderStatus.PENDING_CONFIRMATION) {
      await this.dequeueForExit(orderId, landed, input.ctx);
    }

    // 2. M8 commit 9: the pack queue is a VIRTUAL FIFO over
    // o.status='picked', so entry into PICKED makes the shipment
    // pack-eligible by construction. The audit is the observability hook
    // and the extension point for a real packer notification.
    if (landed === OrderStatus.PICKED && from !== OrderStatus.PICKED) {
      await this.signalPackEligible(orderId, input.ctx);
    }

    // 3. M8 commit 16 (R3 dual-path): provision on entry to CONFIRMED
    // (idempotent on an existing non-CANCELLED shipment); void on entry to
    // a deliberately-ending state (idempotent — no CREATED shipment ⇒
    // {voided:0}; post-pick/pack shipments are no longer CREATED).
    if (landed === OrderStatus.CONFIRMED && from !== OrderStatus.CONFIRMED) {
      await this.provisionShipmentForOrder(input);
    } else if (from !== landed && VOIDABLE_TERMINAL_STATES.has(landed)) {
      await this.voidShipmentForOrder(orderId, landed, input.ctx);
      // AFTER the void so the shipment is dead first — the money step is
      // the one whose failure we most want to be loud about, and putting
      // it last means a failure here cannot leave a live shipment behind.
      await this.unwindMoneyForEndedOrder(input);
    } else if (from !== landed && landed === OrderStatus.LOST_IN_TRANSIT) {
      // A LOST parcel is not charged (the founder, 2026-09-12 — TRE-6):
      // an AT_AWB seller was debited at booking and nothing gave it back,
      // so ₹200 was kept for a parcel nobody delivered and sat on no P&L
      // line. The same refund, the same exactly-once gate; carriage does
      // not matter here, because the parcel's FATE is that it never
      // arrived. The deferred accrual is retired too. "Lost then found"
      // (god mode) re-bills on the re-delivery: charges and refunds pair
      // up, and a retired accrual is re-armed.
      await this.unwindMoneyForLostOrder(input);
    }

    // 4. M11 (NOTIF-1 / NOTIF-5): the lifecycle event, after every prior
    // hook and after commit. Never awaited; double-wrapped (the bus
    // swallows too).
    this.emitLifecycleEvent(input);
  }

  private emitLifecycleEvent(input: StatusChangeHookInput): void {
    try {
      this.lifecycleBus.emit({
        orderId: input.orderId,
        sellerId: input.sellerId,
        from: input.from,
        to: input.landed,
        statusEventId: input.statusEventId,
        actorType: input.actor.type,
        actorId: input.actor.id ?? null,
        occurredAt: new Date(),
        source: input.source,
      });
    } catch (err) {
      this.logger.error(
        {
          orderId: input.orderId,
          from: input.from,
          to: input.landed,
          statusEventId: input.statusEventId,
          source: input.source,
          err: err instanceof Error ? err.message : String(err),
        },
        'Lifecycle-event emit threw despite bus contract; swallowed (NOTIF-1)',
      );
    }
  }

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

  private async provisionShipmentForOrder(input: StatusChangeHookInput): Promise<void> {
    try {
      const order =
        input.snapshot ??
        (await this.prisma.client.order.findFirst({
          where: { id: input.orderId },
          select: PROVISIONABLE_ORDER_SELECT,
        }));
      if (!order) {
        this.logger.error(
          { orderId: input.orderId },
          'Post-commit shipment provision found no order to snapshot; status persisted',
        );
        return;
      }
      await this.provisionFrom(order, input.sellerId, input.ctx);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.error(
        { orderId: input.orderId, source: input.source, err: error },
        'Post-commit shipment provision failed; order CONFIRMED persisted with NO shipment',
      );
      // NOTHING else would see this order: the AWB listener finds no
      // shipment to book (NO_LIVE_SHIPMENT, silently), the pick queue
      // joins shipments, and the AWB-less sweep used to select shipment
      // rows only. So it is raised, once per order; the hourly sweep
      // re-provisions it through `ensureShipmentProvisioned` and clears
      // the issue when that works.
      await this.raiseShipmentMissing(input.orderId, input.sellerId, error);
    }
  }

  /**
   * Provision the order's shipment if it has none — the SAME snapshot and
   * per-seller courier as the post-commit hook, re-read from the committed
   * row. Idempotent (`provisionFromSnapshot` returns an existing live
   * shipment under its per-order lock). THROWS on failure, unlike the hook:
   * the caller (the AWB-less sweep, via `OrderWriteService`) decides how
   * loud to be.
   */
  async ensureShipmentProvisioned(
    orderId: string,
  ): Promise<{ readonly shipmentId: string; readonly created: boolean }> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { ...PROVISIONABLE_ORDER_SELECT, sellerId: true },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);
    return this.provisionFrom(order, order.sellerId);
  }

  private async raiseShipmentMissing(
    orderId: string,
    sellerId: string,
    error: string,
  ): Promise<void> {
    try {
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: 'A confirmed order has no shipment, so nothing can pick or book it',
        detail:
          `The order was confirmed but its shipment could not be created: ${error}\n\n` +
          'Every queue that moves a parcel — the AWB booking, printing, the pick list — ' +
          'selects on a shipment, so this order is invisible to all of them while the seller ' +
          'believes it is on its way. The hourly sweep retries the provision and clears this ' +
          "once it works; if it keeps failing, fix the cause (usually the seller's " +
          'ops.default_courier_code override or the default warehouse setting).',
        source: 'OrderPostCommitHooksService',
        dedupeKey: shipmentMissingIssueKey(orderId),
        metadata: { orderId, sellerId, error },
      });
    } catch {
      // raise() swallows its own failures; this sits in a catch already.
    }
  }

  private async provisionFrom(
    order: ProvisionableOrder,
    sellerId: string,
    ctx?: ClientContext,
  ): Promise<{ readonly shipmentId: string; readonly created: boolean }> {
    const courierCode = await this.resolveCourierCode(sellerId);
    return this.shipmentProvision.provisionFromSnapshot(
      {
        orderId: order.id,
        courierCode,
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
  }

  /**
   * Which courier this seller's new parcel is provisioned with:
   * `ops.default_courier_code`, per seller (SET-1, 2026-09-12). A seller
   * pinned to `manual` gets parcels no integrated courier is ever asked
   * to book — the AWB saga routes them straight to manual placement and
   * never fails over from a courier with no adapter.
   *
   * FAILS CLOSED, unlike most settings reads: an error here propagates
   * into the provision's own catch, so the order stays CONFIRMED with no
   * shipment rather than being provisioned with the global default.
   * Falling back would book a real waybill for a seller who asked for
   * none. "No shipment" is visible because that catch RAISES it
   * (`shipment-missing:<orderId>`) and the hourly AWB-less sweep looks
   * for confirmed orders with no live shipment and retries — the AWB
   * listener does NOT find it (it answers NO_LIVE_SHIPMENT silently).
   */
  private async resolveCourierCode(sellerId: string): Promise<string> {
    const resolved = await this.settings.resolve(sellerId, 'ops.default_courier_code');
    const code = typeof resolved.value === 'string' ? resolved.value.trim() : '';
    if (!code) {
      throw new Error(`ops.default_courier_code resolved empty for seller ${sellerId}`);
    }
    return code;
  }

  /** Voids CREATED shipments only — INCLUDING one that already carries a
   *  waybill (CUR-2b books at CONFIRMED). No courier cancel is fired here
   *  or anywhere downstream: that is operator-triggered (CUR-10). */
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
   * Give back what an order that will now never ship was charged or
   * credited: the delivery fee, an Instant Pay COD credit no courier paid
   * for, and the deferred (T+N) accrual that would otherwise bill it
   * later.
   *
   * WHETHER the parcel left is judged by the writer's trustworthiness:
   * a matrix transition's `from` is a fact (an order in PACKED really is
   * packed), so it is read directly; a god-mode `from` proves nothing (an
   * order forced PENDING_CONFIRMATION → DELIVERED was never carried), so
   * the order's history is asked instead (`parcelLeftWithCourier`, shared
   * with the delivery-time billing so the two cannot disagree). Carriage
   * that happened is never refunded; carriage that did not always is.
   *
   * The deferred accrual is retired WHATEVER the carriage: an order that
   * is no longer delivered must not be billed as delivered, and the sweep
   * re-checks the status too.
   *
   * Best-effort in the sense that it cannot undo the status change; NOT
   * in the sense of quietly giving up — a failure means we hold money for
   * a service we will not perform, so it audits HIGH and names the order.
   * Every step is idempotent under the WALLET lock, so a re-run or a
   * second writer landing too cannot double-credit.
   */
  private async unwindMoneyForEndedOrder(input: StatusChangeHookInput): Promise<void> {
    const { orderId, sellerId, from, landed, source } = input;
    const forced = source === ADMIN_OVERRIDE_SOURCE;
    const label = landed.toLowerCase().replaceAll('_', ' ');
    await this.moneyStep(input, 'wallet.pending_accrual_retire_failed', () =>
      this.endedMoney.retirePendingAccrual(orderId, `ORDER_${landed}`),
    );
    let left: boolean;
    try {
      left = forced
        ? await parcelLeftWithCourier(this.prisma.client, orderId)
        : !REFUNDABLE_FROM_STATES.has(from);
    } catch (e) {
      // Cannot tell — refund nothing rather than guess; audited.
      await this.reportMoneyFailure(input, 'wallet.order_charges_refund_failed', e);
      return;
    }
    // Cancelling a DISPATCHED order is a real thing an admin can do, but
    // the courier already has the parcel.
    if (left) return;
    await this.moneyStep(input, 'wallet.order_charges_refund_failed', () =>
      this.chargesRefund.refundIfCharged(
        orderId,
        sellerId,
        forced
          ? `Order ${label} by admin override before it left with a courier`
          : `Order ${label} before dispatch`,
      ),
    );
    await this.moneyStep(input, 'wallet.instant_pay_reversal_failed', () =>
      this.endedMoney.reverseUncoveredInstantPayCredit(
        orderId,
        sellerId,
        `COD credit taken back — order ${label} before its parcel reached a customer`,
      ),
    );
  }

  /** LOST_IN_TRANSIT: a lost parcel is not charged (TRE-6). */
  private async unwindMoneyForLostOrder(input: StatusChangeHookInput): Promise<void> {
    await this.moneyStep(input, 'wallet.pending_accrual_retire_failed', () =>
      this.endedMoney.retirePendingAccrual(input.orderId, 'ORDER_LOST_IN_TRANSIT'),
    );
    await this.moneyStep(input, 'wallet.order_charges_refund_failed', () =>
      this.chargesRefund.refundIfCharged(
        input.orderId,
        input.sellerId,
        'Parcel lost in transit — a lost parcel is not charged',
      ),
    );
  }

  /** One money step, isolated: its failure is logged and audited HIGH and
   *  never stops the next step or undoes the status change. */
  private async moneyStep(
    input: StatusChangeHookInput,
    failureAction: string,
    step: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await step();
    } catch (e) {
      await this.reportMoneyFailure(input, failureAction, e);
    }
  }

  private async reportMoneyFailure(
    input: StatusChangeHookInput,
    action: string,
    e: unknown,
  ): Promise<void> {
    const { orderId, sellerId, from, landed, source } = input;
    const error = e instanceof Error ? e.message : String(e);
    this.logger.error(
      { orderId, sellerId, from, landed, source, action, err: error },
      'Post-commit money step FAILED on an ended order — money may be held for a parcel that will not ship',
    );
    await this.audit
      .log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        sellerId,
        action,
        entityType: 'order',
        entityId: orderId,
        severity: 'HIGH',
        metadata: {
          ...(source === ADMIN_OVERRIDE_SOURCE ? { trigger: 'force_mutation' } : {}),
          fromStatus: from,
          landedStatus: landed,
          error,
        },
      })
      .catch(() => undefined);
  }

  /** CC-6 post-commit call-queue dequeue (idempotent, best-effort). */
  private async dequeueForExit(
    orderId: string,
    landed: OrderStatus,
    ctx?: ClientContext,
  ): Promise<void> {
    try {
      await this.callQueue.dequeueOrder(orderId, closureReasonFor(landed), ctx);
    } catch (e) {
      this.logger.error(
        { orderId, landed, err: (e as Error).message },
        'Post-commit call-queue dequeue failed; status persisted, entry self-heals on next dequeue',
      );
    }
  }

  /** CC-6 post-commit call-queue enqueue (idempotent — an existing OPEN
   *  entry is a no-op — and best-effort). */
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
}

/** Best-effort closure reason for the entry being closed on
 *  PENDING_CONFIRMATION exit. OUT_OF_STOCK (and any other transient
 *  non-terminal landing) has no precise QueueClosureReason value — it
 *  re-enqueues on return to PENDING_CONFIRMATION; ADMIN_CLOSED is the
 *  neutral system-closed fallback (debt-tracked imprecision). */
function closureReasonFor(landed: OrderStatus): QueueClosureReason {
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
