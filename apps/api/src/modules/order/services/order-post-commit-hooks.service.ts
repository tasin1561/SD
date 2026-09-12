import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  OrderEventType,
  OrderStatus,
  Prisma,
  QueueClosureReason,
  ShipmentStatus,
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
import type { EventActor } from './order-event-writer.service';

/** Marks god mode's own STATUS_CHANGED rows and its lifecycle events. */
export const ADMIN_OVERRIDE_SOURCE = 'ADMIN_OVERRIDE' as const;

/** M8 commit 16: the set of "deliberately ending the order" landings
 *  on which the shipment-provision wiring (R3) should void a CREATED
 *  shipment. voidForOrder is idempotent against non-CREATED shipments,
 *  so this list is intentionally generous — post-pick/pack/dispatch
 *  shipments are no longer CREATED and are naturally untouched. */
export const VOIDABLE_TERMINAL_STATES: ReadonlySet<OrderStatus> = new Set([
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
 *
 * God mode (ORD-2) draws the SAME line from the other side: its forced
 * `from` proves nothing, so it asks whether the order ever reached a
 * status outside this set and the cancel family through a real
 * transition — see `parcelLeftWithCourier`.
 */
export const REFUNDABLE_FROM_STATES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DRAFT,
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CALL_NO_RESPONSE,
  OrderStatus.CALL_RESCHEDULED,
  OrderStatus.AWAITING_SELLER_DECISION,
  // CUR-17 — held for a carrier decision. No waybill exists and
  // nothing has been picked, so this is one of the cheapest points in
  // the lifecycle for a seller to change their mind.
  OrderStatus.AWAITING_COURIER,
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
 * Statuses that mean the courier HAD the parcel: everything outside the
 * refundable allow-list and outside the cancel family itself. DERIVED,
 * so a god-mode cancel refunds exactly when a normal cancel would, and a
 * status added later lands on the no-refund side until somebody puts it
 * on the allow-list.
 */
const PAST_THE_DIVIDING_LINE: readonly OrderStatus[] = Object.values(OrderStatus).filter(
  (s) => !REFUNDABLE_FROM_STATES.has(s) && !VOIDABLE_TERMINAL_STATES.has(s),
);

/** A shipment in one of these was physically with a courier at some point. */
const SHIPMENT_STATUSES_WITH_COURIER: readonly ShipmentStatus[] = [
  ShipmentStatus.HANDED_TO_COURIER,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.AT_HUB,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERY_ATTEMPTED,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.RTO_INITIATED,
  ShipmentStatus.RTO_IN_TRANSIT,
  ShipmentStatus.RTO_DELIVERED,
  ShipmentStatus.LOST,
  ShipmentStatus.DAMAGED,
];

function isAdminOverrideEvent(data: Prisma.JsonValue): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    (data as Record<string, unknown>).source === ADMIN_OVERRIDE_SOURCE
  );
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
 *   3. Shipment: provision on entry to CONFIRMED; or on entry to a
 *      cancel/reject terminal, void, THEN refund a delivery fee taken for
 *      a parcel that never left.
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
      await this.refundChargesForEndedOrder(input);
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
      const courierCode = await this.resolveCourierCode(input.sellerId);
      await this.shipmentProvision.provisionFromSnapshot(
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
        input.ctx,
      );
    } catch (e) {
      this.logger.error(
        { orderId: input.orderId, source: input.source, err: (e as Error).message },
        'Post-commit shipment provision failed; order CONFIRMED persisted, supervisor/reconciler can re-trigger via OrderAdminOverrideService or a follow-up CONFIRMED→CONFIRMED matrix self-loop',
      );
    }
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
   * shipment (visible — the AWB listener and the watchdog find it)
   * rather than being provisioned with the global default. Falling back
   * would book a real waybill for a seller who asked for none.
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
   * Give back a delivery fee taken for a parcel that will now never ship.
   *
   * WHETHER the parcel left is judged by the writer's trustworthiness:
   * a matrix transition's `from` is a fact (an order in PACKED really is
   * packed), so it is read directly; a god-mode `from` proves nothing (an
   * order forced PENDING_CONFIRMATION → DELIVERED was never carried), so
   * the order's history is asked instead (`parcelLeftWithCourier`).
   * Carriage that happened is never refunded; carriage that did not
   * always is.
   *
   * Best-effort in the sense that it cannot undo the status change; NOT
   * in the sense of quietly giving up — a failure means we hold money for
   * a service we will not perform, so it audits HIGH and names the order.
   * `refundIfCharged` is idempotent on the order (one
   * ORDER_CHARGES_REFUND, read under the WALLET lock), so a re-run or a
   * second writer landing too cannot double-credit.
   */
  private async refundChargesForEndedOrder(input: StatusChangeHookInput): Promise<void> {
    const { orderId, sellerId, from, landed, source } = input;
    const forced = source === ADMIN_OVERRIDE_SOURCE;
    try {
      if (forced) {
        if (await this.parcelLeftWithCourier(orderId)) return;
      } else if (!REFUNDABLE_FROM_STATES.has(from)) {
        // Cancelling a DISPATCHED order is a real thing an admin can do,
        // but the courier already has the parcel.
        return;
      }
      await this.chargesRefund.refundIfCharged(
        orderId,
        sellerId,
        forced
          ? `Order ${landed.toLowerCase().replaceAll('_', ' ')} by admin override before it left with a courier`
          : `Order ${landed.toLowerCase().replaceAll('_', ' ')} before dispatch`,
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.error(
        { orderId, sellerId, from, landed, source, err: error },
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
          metadata: {
            ...(forced ? { trigger: 'force_mutation' } : {}),
            fromStatus: from,
            landedStatus: landed,
            error,
          },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Did this order's parcel ever leave with a courier?
   *
   * Two independent facts, either one enough:
   *  - a shipment on the order was handed over (scanned at the handover
   *    bench, or in any status only a courier puts it in). God mode never
   *    touches shipment status, so this is physical evidence it cannot
   *    fake.
   *  - the order reached a status past the dividing line through a REAL
   *    transition — a STATUS_CHANGED row not stamped `source:
   *    ADMIN_OVERRIDE`. God mode's own rows are skipped: a status it
   *    forced is exactly the claim under suspicion.
   */
  private async parcelLeftWithCourier(orderId: string): Promise<boolean> {
    const handedOver = await this.prisma.client.shipment.count({
      where: {
        orderShipments: { some: { orderId } },
        OR: [
          { handoverScannedAt: { not: null } },
          { status: { in: [...SHIPMENT_STATUSES_WITH_COURIER] } },
        ],
      },
    });
    if (handedOver > 0) return true;

    const reached = await this.prisma.client.orderEvent.findMany({
      where: {
        orderId,
        type: OrderEventType.STATUS_CHANGED,
        toStatus: { in: [...PAST_THE_DIVIDING_LINE] },
      },
      select: { data: true },
    });
    return reached.some((e) => !isAdminOverrideEvent(e.data));
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
