import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type OrderStatus, ShipmentStatus } from '@skydrop/db';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
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
      // catches sync throws but NOT promise rejections. Use a
      // void-returning trampoline that catches the rejection.
      void this.handle(event).catch((err) => {
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
      });
    });
    this.logger.log('NotificationListener subscribed to OrderLifecycleEventBus');
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
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
      // NDR — the courier reason is not currently surfaced on the
      // order in M10; pass a generic copy until M10/M12 surfaces it.
      ndr_reason: '',
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
          },
        },
        // The live shipment (excluding CANCELLED / FAILED_AT_CREATION
        // — same predicate transitionWithDispatch uses) so we get the
        // AWB + courier display name.
        orderShipments: {
          where: {
            shipment: {
              status: {
                notIn: [
                  ShipmentStatus.CANCELLED,
                  ShipmentStatus.FAILED_AT_CREATION,
                ],
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
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      sellerId: order.sellerId,
      sellerEmail: order.seller.email,
      companyName: order.seller.companyName ?? null,
      customerId: order.customerId,
      recipientName: order.recipientName,
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
    };
  }
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
}

// Local re-import for the orderShipments type narrowing — keeps the
// build clean without dragging in the full schema.prisma type names.
// (intentionally empty — types above are inferred from Prisma)
export type { OrderStatus };
