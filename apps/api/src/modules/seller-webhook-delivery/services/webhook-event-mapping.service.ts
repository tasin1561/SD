import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';

/**
 * Single-source mapping for "the order status a lifecycle event
 * landed on → the seller-facing webhook event code". The FOURTH
 * instance of the single-source-mapping pattern after CC-2 /
 * TRK-5 / NOTIF-4. Pure logic, no Prisma.
 *
 * Sellers subscribe to these stable string codes in their
 * SellerWebhookEndpoint.subscribedEvents array; this service is
 * the contract for what those codes mean.
 *
 * F2 discipline: `resolveForOrderStatus(to)` performs an EXHAUSTIVE
 * TypeScript switch over every `OrderStatus` value — a future enum
 * addition fails to compile until the author consciously assigns it
 * a code (or `null` for internal-only transitions).
 *
 * Codes are FLAT and STABLE — sellers wire them once and shouldn't
 * have to re-subscribe when the internal lifecycle gains a state.
 */
@Injectable()
export class WebhookEventMappingService {
  resolveForOrderStatus(to: OrderStatus): string | null {
    switch (to) {
      // Pre-confirmation: internal, no broadcast.
      case OrderStatus.DRAFT:
      case OrderStatus.PENDING_CONFIRMATION:
      case OrderStatus.CALL_NO_RESPONSE:
      case OrderStatus.CALL_RESCHEDULED:
        return null;

      case OrderStatus.CONFIRMED:
        return 'order.confirmed';
      case OrderStatus.OUT_OF_STOCK:
        return 'order.out_of_stock';

      // Cancels + rejects
      case OrderStatus.CANCELLED:
      case OrderStatus.CANCELLED_BY_ADMIN:
        return 'order.cancelled';
      case OrderStatus.REJECTED:
      case OrderStatus.REJECTED_BY_CUSTOMER:
        return 'order.rejected';
      case OrderStatus.REJECTED_NDR:
        return 'order.rejected_ndr';
      // R5b — NOT a rejection: we stopped calling and are waiting for the
      // seller to say whether to keep trying. A B2B integration needs its
      // own code for this, because reacting to it (answer the review) is
      // completely different from reacting to a rejection (write the
      // order off).
      case OrderStatus.AWAITING_SELLER_DECISION:
        return 'order.awaiting_seller_decision';

      // Warehouse lifecycle
      case OrderStatus.PENDING_PICK:
        return 'order.pending_pick';
      case OrderStatus.PICKED:
        return 'order.picked';
      case OrderStatus.PACKED:
        return 'order.packed';
      case OrderStatus.PACK_FAILED:
        return 'order.pack_failed';
      case OrderStatus.PENDING_DISPATCH:
        return null; // courier-internal, waiting for AWB
      case OrderStatus.PENDING_MANUAL_PLACEMENT:
        return 'order.requires_manual_courier';

      // Courier + tracking
      case OrderStatus.DISPATCHED:
        return 'shipment.dispatched';
      case OrderStatus.IN_TRANSIT:
        return 'shipment.in_transit';
      case OrderStatus.OUT_FOR_DELIVERY:
        return 'shipment.out_for_delivery';
      case OrderStatus.DELIVERED:
        return 'shipment.delivered';
      case OrderStatus.DELIVERY_FAILED:
        return 'shipment.delivery_attempted';

      // RTO chain
      case OrderStatus.RTO_INITIATED:
        return 'shipment.return_initiated';
      case OrderStatus.RTO_IN_TRANSIT:
        return 'shipment.returning';
      case OrderStatus.RTO_RECEIVED:
        return 'shipment.returned';
      case OrderStatus.RTO_RESTOCKED:
        return 'shipment.return_finalized';
      case OrderStatus.RTO_DAMAGED:
        return 'shipment.return_damaged';

      // Loss
      case OrderStatus.LOST_IN_TRANSIT:
        return 'shipment.lost';
    }
  }
}
