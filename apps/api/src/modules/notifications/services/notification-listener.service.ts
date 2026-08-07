import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type OrderStatus, ShipmentStatus } from '@skydrop/db';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { stripSellerPrefix } from '../../../common/text/recipient-name';
import { EnvService } from '../../../config/env.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import {
  NotificationEventMappingService,
  type NotificationFanOut,
} from './notification-event-mapping.service';
import { NotificationLedgerService } from './notification-ledger.service';
import type { EmailVariables } from '../../email/email.types';

/**
 * Module 11 (NOTIF-3 fan-out point) — the bus subscriber that
 * translates one OrderLifecycleEvent into N independent
 * NotificationLedgerService.enqueue() calls (one per fan-out target
 * resolved by NotificationEventMappingService).
 *
 * On every emit:
 *   1. Walk the mapping for `event.to`. Empty → no work.
 *   2. Load the order's seller + recipient snapshot + most recent live
 *      shipment (for AWB + tracking URL). Single query.
 *   3. For each fan-out target — independently:
 *      - SELLER channel: address = order.seller.email (always non-null
 *        by schema; live record per the locked decision — sellers see
 *        their CURRENT email, not a snapshot, which would surprise
 *        them after a profile email change).
 *      - CUSTOMER channel: address = order.recipientEmail snapshot
 *        (ORD-6 — the canonical customer-side address; NOT
 *        Customer.email, which could differ post-hoc after edits).
 *      - recipientId: order.sellerId (SELLER) / order.customerId
 *        ?? order.id (CUSTOMER fallback — orderId-as-surrogate keeps
 *        the dedup tuple concrete when no Customer row exists; see
 *        NotificationLedgerService docs).
 *      - Build the templated variable set (a superset; Nunjucks
 *        renders missing vars as empty per
 *        `throwOnUndefined: false` in TemplateRenderService).
 *      - Call NotificationLedgerService.enqueue() wrapped in a
 *        per-target try/catch — NOTIF-3 independence: one target's
 *        failure NEVER aborts the loop or leaks into other targets.
 *
 * NOTIF-5: the order module never imports / never references this
 * class. The wiring goes through the R3 OrderLifecycleEventBus.
 *
 * NOTIF-1: the OrderLifecycleEventBus.emit() boundary already
 * swallows exceptions, but the per-target try/catch here adds the
 * second layer (mapping resolution failure must not poison the fan-
 * out either).
 */
@Injectable()
export class NotificationListener implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationListener.name);
  private subscription: Subscription | null = null;
  // M11 follow-up: in-flight handle() promises must be DRAINED at
  // teardown. Bus.emit is synchronous; the subscribe wrapper spawns
  // handle() via `void ... .catch()` and returns to the emitter
  // immediately — so handle()'s async work (loadOrderContext +
  // per-target ledger.enqueue) outlives emit. In the e2e harness each
  // test SUITE boots and closes its own Nest app; without an explicit
  // drain, the prior suite's in-flight handle() promises continue
  // executing against the (singleton) PrismaClient + (logical) Redis
  // db while the next suite resets state. That manifests as the
  // "Force exiting Jest async operations" warning AND surfaces as
  // intermittent cross-suite flakes when a leaked write contends with
  // the next suite's TRUNCATE / next test's reservation assertions.
  // We track every in-flight promise here and Promise.allSettled them
  // in onModuleDestroy AFTER unsubscribing (so no new work joins the
  // set mid-drain). Production cost is negligible (a Set add/delete
  // per emit); the value is deterministic test teardown.
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly mapping: NotificationEventMappingService,
    private readonly ledger: NotificationLedgerService,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  onApplicationBootstrap(): void {
    // Subscribe AFTER full DI graph is up so the ledger / mapping /
    // prisma are all available. Bootstrap (not module init) so we
    // can never fire before the rest of the app is ready.
    this.subscription = this.bus.subscribe((event) => {
      // The handler returns a Promise; the bus' subscribe wrapper
      // catches sync throws but NOT promise rejections. Track the
      // promise so onModuleDestroy can drain it; the .catch keeps
      // NOTIF-1 (best-effort, never throws to the emitter); the
      // .finally removes it from the in-flight set on settle so the
      // set stays bounded under steady-state load.
      const p = this.handle(event)
        .catch((err) => {
          this.logger.error(
            {
              orderId: event.orderId,
              from: event.from,
              to: event.to,
              statusEventId: event.statusEventId,
              err: (err as Error).message,
            },
            'NotificationListener: handle() rejected; swallowed (NOTIF-1)',
          );
        })
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    });
    this.logger.log('NotificationListener subscribed to OrderLifecycleEventBus');
  }

  async onModuleDestroy(): Promise<void> {
    // Unsubscribe FIRST so a late emit during drain doesn't append a
    // new promise to the set; allSettled (never throws) AWAITS every
    // in-flight handle() so cross-suite contamination cannot happen.
    // The bus' own onModuleDestroy completes the Subject — Nest tears
    // down dependents (this listener) before dependencies (the bus
    // module), so unsubscribe + drain run BEFORE the bus completes,
    // matching the documented teardown ordering invariant.
    this.subscription?.unsubscribe();
    this.subscription = null;
    await this.drainInFlight();
  }

  /**
   * Await every in-flight handle() promise. Public so the e2e harness
   * can quiesce listener work BETWEEN tests within a suite (the app
   * stays up across tests in a suite; only afterAll closes it, so
   * onModuleDestroy alone is insufficient for within-suite
   * isolation). The use case: a test's transition emits a lifecycle
   * event → handle() spawns async ledger writes that acquire FK
   * RowShareLocks on orders/shipments → the NEXT test's beforeEach
   * TRUNCATE wants AccessExclusiveLock and deadlocks against the
   * still-running INSERT. Calling drainInFlight() before the
   * TRUNCATE chain serialises listener work and prevents the
   * deadlock. Safe to call repeatedly; no-op when the set is empty.
   */
  async drainInFlight(): Promise<void> {
    if (this.inFlight.size === 0) return;
    await Promise.allSettled([...this.inFlight]);
  }

  async handle(event: OrderLifecycleEvent): Promise<void> {
    const targets = this.mapping.resolveForOrderStatus(event.to);
    if (targets.length === 0) {
      // Mapping deliberately resolves "no notification for this
      // status" — log at debug so ops sees activity without warning
      // noise.
      this.logger.debug(
        {
          orderId: event.orderId,
          from: event.from,
          to: event.to,
          statusEventId: event.statusEventId,
        },
        'NotificationListener: no fan-out targets for this status',
      );
      return;
    }

    const ctx = await this.loadOrderContext(event.orderId);
    if (!ctx) {
      // The order disappeared between emit and load (soft-delete or
      // race) — NOTHING to send. Logged at warn for forensics.
      this.logger.warn(
        { orderId: event.orderId, to: event.to },
        'NotificationListener: order not found at load time; skipping fan-out',
      );
      return;
    }

    const trackingUrl = ctx.awbNumber
      ? `${this.env.publicTrackingUrl}/${encodeURIComponent(ctx.awbNumber)}`
      : '';
    const variables = this.buildVariables(ctx, event, trackingUrl);
    const eventIdBase = `order_status:${event.statusEventId}`;
    const triggerEvent = `order_status:${event.from}_to_${event.to}`;

    for (const target of targets) {
      try {
        const resolved = this.resolveTarget(target, ctx);
        await this.ledger.enqueue({
          eventId: eventIdBase,
          recipientType: target.recipientType,
          recipientId: resolved.recipientId,
          channel: target.channel,
          templateCode: target.templateCode,
          locale: target.locale,
          toEmail: resolved.toEmail,
          variables,
          orderId: ctx.orderId,
          // DELIBERATELY null: a notification_logs.shipment_id FK
          // INSERT acquires a PG `FOR KEY SHARE` row lock on the
          // parent `shipments` row for the duration of the INSERT.
          // That conflicts with PickQueueService.pullNext's
          // `FOR UPDATE OF s SKIP LOCKED` (WMS-2), causing pullNext
          // to silently skip the just-provisioned shipment on a
          // CONFIRMED transition fan-out race (characterised at
          // ~80% flake rate against tracking-flow's
          // driveToDispatched helper before this fix). The forensic
          // linkage via notification_logs.order_id is sufficient —
          // the live shipment is reachable through the order's
          // relations. Captured in phase-1a-debt (commit 10).
          shipmentId: null,
          triggerEvent,
        });
      } catch (err) {
        // NOTIF-3 independence: one target's failure NEVER aborts
        // the others. Logged with full context for forensics; the
        // out-of-band reconciler / next event will reconcile (M11
        // commit-10 phase-1a-debt entry).
        this.logger.error(
          {
            orderId: event.orderId,
            statusEventId: event.statusEventId,
            recipientType: target.recipientType,
            templateCode: target.templateCode,
            err: (err as Error).message,
          },
          'NotificationListener: per-target enqueue failed; continuing fan-out',
        );
      }
    }
  }

  /** Resolve the per-target recipient id + address (NOTIF-8 SKIPPED
   *  is left to the ledger when toEmail is null). */
  private resolveTarget(
    target: NotificationFanOut,
    ctx: OrderContext,
  ): { recipientId: string; toEmail: string | null } {
    if (target.recipientType === 'SELLER') {
      return {
        recipientId: ctx.sellerId,
        toEmail: ctx.sellerEmail, // always non-null per schema
      };
    }
    // CUSTOMER
    return {
      // orderId-as-surrogate keeps the dedup tuple concrete when
      // the order has no Customer row (e.g., draft-without-customer
      // edge cases). Documented in NotificationLedgerService.
      recipientId: ctx.customerId ?? ctx.orderId,
      toEmail: ctx.recipientEmail, // ORD-6 snapshot; nullable → SKIPPED
    };
  }

  /** Build the union variable set for ALL Q5 templates. Templates use
   *  only the vars they need; unused vars stringify to empty under
   *  Nunjucks `throwOnUndefined: false` (TemplateRenderService). */
  private buildVariables(
    ctx: OrderContext,
    event: OrderLifecycleEvent,
    trackingUrl: string,
  ): EmailVariables {
    return {
      // Identity
      order_number: ctx.orderNumber,
      company_name: ctx.companyName ?? '',
      seller_company_name: ctx.companyName ?? '',
      customer_name: ctx.recipientName ?? '',
      // Recipient block (from order snapshot per ORD-6)
      recipient_name: ctx.recipientName ?? '',
      recipient_city: ctx.recipientCity ?? '',
      recipient_state: ctx.recipientState ?? '',
      // Money
      cod_amount_inr: ctx.codAmountInr ?? '',
      // Shipment / courier
      awb_number: ctx.awbNumber ?? '',
      courier_name: ctx.courierName ?? '',
      tracking_url: trackingUrl,
      expected_delivery_at: ctx.expectedDeliveryAt ?? '',
      delivered_at: ctx.deliveredAt ?? '',
      // Cancellation
      cancellation_reason: ctx.cancellationReason ?? '',
      // NDR reason — M13 CP2.A.1 surfaces it from the latest
      // delivery_attempt on the live shipment (closes the M11
      // ndr_reason phase-1a-debt entry). Humanized enum (e.g.,
      // 'Customer Phone Unreachable'), free-text notes fallback,
      // empty string if neither is present.
      ndr_reason: ctx.ndrReason ?? '',
      // Static
      app_url: this.env.sellerAppUrl,
      support_email: this.env.supportEmail,
      // Forensic — useful for debug-rendered templates / future
      // status-changed copy
      old_status: String(event.from),
      new_status: String(event.to),
    };
  }

  private async loadOrderContext(orderId: string): Promise<OrderContext | null> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        sellerId: true,
        customerId: true,
        recipientName: true,
        recipientEmail: true,
        recipientCity: true,
        recipientStateProvince: true,
        codAmountInr: true,
        cancellationReason: true,
        expectedDeliveryAt: true,
        seller: {
          select: {
            email: true,
            companyName: true,
            initials: true,
          },
        },
        // The live shipment (excluding CANCELLED / FAILED_AT_CREATION
        // — same predicate transitionWithDispatch uses) so we get the
        // AWB + courier display name. M13 CP2.A.1 added the latest
        // delivery_attempts row so the NDR template variables can
        // surface a real failure reason (phase-1a-debt M11 ndr_reason
        // closure).
        orderShipments: {
          where: {
            shipment: {
              status: {
                notIn: [ShipmentStatus.CANCELLED, ShipmentStatus.FAILED_AT_CREATION],
              },
              deletedAt: null,
            },
          },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
          select: {
            shipment: {
              select: {
                id: true,
                awbNumber: true,
                deliveredAt: true,
                courier: { select: { name: true, code: true } },
                deliveryAttempts: {
                  orderBy: { attemptedAt: 'desc' },
                  take: 1,
                  select: {
                    failureReason: true,
                    failureNotes: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return null;

    const liveShipment = order.orderShipments[0]?.shipment ?? null;
    const formatDate = (d: Date | null | undefined): string =>
      d ? d.toISOString().slice(0, 10) : '';
    // M13 CP2.A.1 — surface the NDR reason from the latest delivery
    // attempt. Prefer the structured enum (humanized) over the
    // free-text notes (operator-authored, may contain PII). Null both
    // → empty (the NDR templates read naturally without it; the M11
    // generic-copy fallback from the original M11 work remains the
    // intent).
    const latestAttempt = liveShipment?.deliveryAttempts?.[0] ?? null;
    const ndrReason: string | null = latestAttempt?.failureReason
      ? humanizeFailureReason(latestAttempt.failureReason)
      : latestAttempt?.failureNotes?.trim() || null;
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      sellerId: order.sellerId,
      sellerEmail: order.seller.email,
      companyName: order.seller.companyName ?? null,
      customerId: order.customerId,
      // The stored name carries the seller's code (see
      // common/text/recipient-name.ts). It comes OFF here: this feeds
      // `customer_name` in templates, and an order confirmation opening
      // "Hello MSt John Doe" reads as a system error to the person we
      // are asking to hand cash to a courier.
      recipientName: stripSellerPrefix(order.seller.initials, order.recipientName),
      recipientEmail: order.recipientEmail,
      recipientCity: order.recipientCity,
      recipientState: order.recipientStateProvince,
      codAmountInr: order.codAmountInr ? order.codAmountInr.toFixed(2) : null,
      cancellationReason: order.cancellationReason ?? null,
      expectedDeliveryAt: formatDate(order.expectedDeliveryAt),
      shipmentId: liveShipment?.id ?? null,
      awbNumber: liveShipment?.awbNumber ?? null,
      courierName: liveShipment?.courier?.name ?? null,
      deliveredAt: formatDate(liveShipment?.deliveredAt),
      ndrReason,
    };
  }
}

/** Underscore-snake_case enum → Title Case display string. Mirrors
 *  the @skydrop/ui statusLabel helper but lives here to avoid a
 *  frontend package import. */
function humanizeFailureReason(reason: string): string {
  return String(reason)
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

interface OrderContext {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly sellerEmail: string;
  readonly companyName: string | null;
  readonly customerId: string | null;
  readonly recipientName: string;
  readonly recipientEmail: string | null;
  readonly recipientCity: string;
  readonly recipientState: string;
  readonly codAmountInr: string | null;
  readonly cancellationReason: string | null;
  readonly expectedDeliveryAt: string;
  readonly shipmentId: string | null;
  readonly awbNumber: string | null;
  readonly courierName: string | null;
  readonly deliveredAt: string;
  /** M13 CP2.A.1: the NDR template's `ndr_reason` variable. Humanized
   *  enum from the latest delivery_attempt's failureReason, falling
   *  back to failureNotes, null if neither is present. */
  readonly ndrReason: string | null;
}

// Local re-import for the orderShipments type narrowing — keeps the
// build clean without dragging in the full schema.prisma type names.
// (intentionally empty — types above are inferred from Prisma)
export type { OrderStatus };
