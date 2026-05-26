import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
  OrderStatus,
} from '@skydrop/db';

/**
 * One fan-out target: a single ledger row to enqueue.
 *
 * `templateCode` matches an existing seeded notification_templates.code
 * (Module 11 commit 2 added the missing customer-bilingual + seller
 * lifecycle templates; the M7/M8 templates for CONFIRMED + RTO_INITIATED
 * are reused unchanged).
 *
 * `locale` is the language requested when rendering. Phase-1A:
 *   - SELLER: always 'en' (Q6).
 *   - CUSTOMER: always 'en'; the seeded EN-tagged template body itself
 *     contains BOTH English + Hindi (the bilingual-in-one-email shape
 *     locked at Q6). This gives every customer the Hindi text without
 *     needing a stored per-recipient locale preference today; Phase-2
 *     stored preferences slot in by changing this single field per
 *     recipient.
 *
 * `channel` is fixed to EMAIL in Phase-1A; the SMS/WhatsApp placeholders
 * exist in the NotificationChannel enum so this field can be widened
 * later without an enum migration.
 */
export interface NotificationFanOut {
  readonly recipientType: NotificationRecipientType;
  readonly templateCode: string;
  readonly locale: string;
  readonly channel: NotificationChannel;
}

/**
 * Module 11 (NOTIF-4) — the SINGLE SOURCE OF TRUTH for
 * "order status the lifecycle landed on → which outbound notifications
 * fan out". Pure logic, no Prisma, no Order dependency — the THIRD
 * single-source-mapping instance after:
 *   - CallOutcomeMappingService (CC-2 / M7)
 *   - TrackingStatusMappingService (TRK-5 / M10)
 *
 * The Q5 mapping table:
 *
 *   CONFIRMED                → seller(EN) + customer(bilingual)
 *   DISPATCHED               → seller(EN) + customer(bilingual)
 *                              ★ priority template — carries the M10
 *                              tracking URL pointing at
 *                              GET /public/tracking/:awb
 *   OUT_FOR_DELIVERY         → customer(bilingual)         [no seller]
 *   DELIVERED                → seller(EN) + customer(bilingual)
 *   DELIVERY_FAILED (NDR)    → seller(EN) + customer(bilingual)
 *   RTO_INITIATED            → seller(EN)
 *   RTO_RECEIVED             → seller(EN)
 *   CANCELLED                → seller(EN) + customer(bilingual)
 *   PENDING_MANUAL_PLACEMENT → [] (internal-only by Q5)
 *   every other OrderStatus  → [] explicitly
 *
 * F2 / NOTIF-4 discipline: `resolveForOrderStatus(to)` performs an
 * EXHAUSTIVE TypeScript switch over `OrderStatus`. A future enum value
 * fails to compile until the author consciously routes it (to a
 * fan-out array OR to []). Mirrors TRK-5's compile-time discipline.
 *
 * The mapping/state-machine consistency story differs from M10's:
 * M10's TrackingStatusMappingService.allowedFromOrderStatuses had to
 * mirror M9's matrix because a stale-`from` produced a silent 409.
 * Here the mapping is a 1:N fan-out keyed on the LANDING status only
 * (`to`), independent of `from`, so there is no inbound-edge consistency
 * to police — only "is the template seeded?" (covered by the unit test
 * that walks resolveForOrderStatus → notification_templates.findUnique).
 */
@Injectable()
export class NotificationEventMappingService {
  resolveForOrderStatus(to: OrderStatus): readonly NotificationFanOut[] {
    switch (to) {
      // ─── Pre-confirmation lifecycle (no outbound notifications) ───
      case OrderStatus.DRAFT:
      case OrderStatus.PENDING_CONFIRMATION:
      case OrderStatus.CALL_NO_RESPONSE:
      case OrderStatus.CALL_RESCHEDULED:
      case OrderStatus.OUT_OF_STOCK:
        return EMPTY;

      // ─── CONFIRMED ─────────────────────────────────────────────────
      case OrderStatus.CONFIRMED:
        return [
          {
            recipientType: NotificationRecipientType.SELLER,
            // Existing M7 seed — reused unchanged.
            templateCode: 'order.confirmed.seller.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
          {
            recipientType: NotificationRecipientType.CUSTOMER,
            templateCode: 'customer.order_confirmed.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];

      // ─── Cancellation family ───────────────────────────────────────
      case OrderStatus.CANCELLED:
        return [
          {
            recipientType: NotificationRecipientType.SELLER,
            templateCode: 'seller.order_cancelled.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
          {
            recipientType: NotificationRecipientType.CUSTOMER,
            templateCode: 'customer.order_cancelled.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];
      // Q5 says "Order CANCELLED" — interpret literally. Admin / call-
      // center rejections (CANCELLED_BY_ADMIN, REJECTED, REJECTED_BY_
      // CUSTOMER, REJECTED_NDR) are deliberately silent in Phase-1A;
      // adding them is a one-line additive change once stakeholders
      // ask. Tracked as a Phase-2 entry in phase-1a-debt (commit 10).
      case OrderStatus.CANCELLED_BY_ADMIN:
      case OrderStatus.REJECTED:
      case OrderStatus.REJECTED_BY_CUSTOMER:
      case OrderStatus.REJECTED_NDR:
        return EMPTY;

      // ─── Warehouse internal lifecycle (no outbound) ────────────────
      case OrderStatus.PENDING_PICK:
      case OrderStatus.PICKED:
      case OrderStatus.PACKED:
      case OrderStatus.PACK_FAILED:
      case OrderStatus.PENDING_DISPATCH:
        return EMPTY;

      // ─── DISPATCHED ★ — the priority template carries
      //     {{ tracking_url }} pointing at M10
      //     GET /public/tracking/:awb. ──────────────────────────────
      case OrderStatus.DISPATCHED:
        return [
          {
            recipientType: NotificationRecipientType.SELLER,
            templateCode: 'seller.order_dispatched.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
          {
            recipientType: NotificationRecipientType.CUSTOMER,
            templateCode: 'customer.order_dispatched.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];

      // ─── In-flight lifecycle ───────────────────────────────────────
      case OrderStatus.IN_TRANSIT:
        return EMPTY;

      case OrderStatus.OUT_FOR_DELIVERY:
        return [
          // Q5: customer-only (the seller already saw DISPATCHED).
          {
            recipientType: NotificationRecipientType.CUSTOMER,
            templateCode: 'customer.order_out_for_delivery.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];

      case OrderStatus.DELIVERED:
        return [
          {
            recipientType: NotificationRecipientType.SELLER,
            templateCode: 'seller.order_delivered.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
          {
            recipientType: NotificationRecipientType.CUSTOMER,
            templateCode: 'customer.order_delivered.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];

      case OrderStatus.DELIVERY_FAILED:
        return [
          {
            recipientType: NotificationRecipientType.SELLER,
            templateCode: 'seller.order_delivery_failed.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
          {
            recipientType: NotificationRecipientType.CUSTOMER,
            templateCode: 'customer.order_delivery_failed.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];

      // ─── RTO chain (Q5 — seller-only) ──────────────────────────────
      case OrderStatus.RTO_INITIATED:
        return [
          {
            recipientType: NotificationRecipientType.SELLER,
            // Existing M5/M8 seed — reused unchanged.
            templateCode: 'shipment.rto_initiated.seller.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];

      case OrderStatus.RTO_RECEIVED:
        return [
          {
            recipientType: NotificationRecipientType.SELLER,
            templateCode: 'seller.order_rto_received.email',
            locale: 'en',
            channel: NotificationChannel.EMAIL,
          },
        ];

      // ─── RTO downstream + lost (informational only — Phase-2 may
      //     want a customer apology email on LOST_IN_TRANSIT) ────────
      case OrderStatus.RTO_IN_TRANSIT:
      case OrderStatus.RTO_RESTOCKED:
      case OrderStatus.RTO_DAMAGED:
      case OrderStatus.LOST_IN_TRANSIT:
        return EMPTY;

      // ─── PENDING_MANUAL_PLACEMENT (Q5 — INTERNAL-ONLY) ────────────
      case OrderStatus.PENDING_MANUAL_PLACEMENT:
        return EMPTY;

      // ─── exhaustiveness guard ─────────────────────────────────────
      // A future OrderStatus addition fails to compile here until the
      // author consciously routes it.
      default:
        return assertNever(to);
    }
  }
}

const EMPTY: readonly NotificationFanOut[] = Object.freeze([]);

function assertNever(value: never): never {
  throw new Error(
    `NotificationEventMappingService: unhandled OrderStatus value ${String(value)} ` +
      `— add it to the switch (route to a fan-out array or to [] explicitly).`,
  );
}
