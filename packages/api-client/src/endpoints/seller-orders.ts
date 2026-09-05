/**
 * Seller order ops surface (M6 seller-facing endpoints).
 *
 * The CP2.A "Orders" pattern-setter uses:
 *   GET  /seller/orders                  (list — sellerId implied from JWT)
 *   GET  /seller/orders/:id              (detail + items)
 *   GET  /seller/orders/:id/events       (filtered timeline — isVisibleToSeller=true)
 *   POST /seller/orders/:id/cancel       (pre-reservation cancel)
 *
 * Most types are reused from admin-orders (the underlying shape is the
 * same — OrderView + OrderListItem + OrderItemView). The seller-only
 * additions live here.
 */
import type { ActorType, OrderEventType, OrderStatus } from '@skydrop/db';

/** Server returns `ListOrdersQueryDto` — same DTO seller + admin share.
 *  Seller's variant drops `sellerId` (implicit) but the type stays
 *  permissive for re-use. */
export interface ListSellerOrdersQuery {
  readonly status?: OrderStatus;
  /** orderNumber / sellerOrderRef / recipient name / phone / AWB. */
  readonly search?: string;
  /** ISO instants; either end alone is a valid filter. */
  readonly placedFrom?: string;
  readonly placedTo?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/** Seller-facing lifecycle event projection. Matches the server-side
 *  `OrderEventView` (ORDER_EVENT_SELECT). Filtered to
 *  `isVisibleToSeller=true` rows server-side. */
export interface SellerOrderEventView {
  readonly id: string;
  readonly type: OrderEventType;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus | null;
  readonly description: string | null;
  readonly data: unknown;
  readonly actorType: ActorType | null;
  readonly createdAt: string;
}

/** The seller's own default for the delivery-fee field on a new order. */
export interface CustomerDeliveryFeeView {
  readonly amountInr: string;
  /** true when the seller set it; false when it is the platform default. */
  readonly isOwnValue: boolean;
}
