/**
 * Admin order ops surface (M6). Captured from the M12 pre-flight.
 *
 * The CP2 "Order ops" feature area uses:
 *   GET  /admin/orders                       (list cross-seller + filters)
 *   GET  /admin/orders/:id                   (detail + items + events)
 *   POST /admin/orders/:id/cancel            (sane admin cancel — state machine)
 *   POST /admin/orders/:id/force-mutation    (GOD MODE — ORD-2, hostile UX)
 *   POST /admin/orders/:id/release-reservations (god-mode cleanup)
 */
import type {
  OrderCancellationReason,
  OrderSource,
  OrderStatus,
  PackageType,
  PaymentMode,
} from '@skydrop/db';

export interface ListOrdersQuery {
  readonly status?: OrderStatus;
  readonly source?: OrderSource;
  readonly search?: string;
  readonly sellerId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface OrderListItem {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  readonly source: OrderSource;
  readonly recipientName: string;
  readonly recipientCity: string;
  readonly recipientStateProvince: string;
  readonly codAmountInr: string | null;
  readonly placedAt: string;
  readonly sellerId: string;
}

export interface OrderListResponse {
  readonly items: readonly OrderListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface OrderEventView {
  readonly id: string;
  readonly type: string;
  readonly description: string | null;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly isVisibleToSeller: boolean;
  readonly createdAt: string;
}

/** The full admin order view — items + events + everything the
 *  detail screen renders. Loosely typed where it mirrors the
 *  Prisma `ORDER_VIEW_INCLUDE` select; tighten as the UI consumes
 *  specific fields. */
export interface OrderItemView {
  readonly id: string;
  readonly variantId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly quantity: number;
}

export interface OrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly sellerId: string;
  readonly status: OrderStatus;
  readonly source: OrderSource;

  // Recipient snapshot (ORD-6 immutable)
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientAltPhoneE164: string | null;
  readonly recipientEmail: string | null;
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2: string | null;
  readonly recipientLandmark: string | null;
  readonly recipientCity: string;
  readonly recipientStateProvince: string;
  readonly recipientPostalCode: string;
  readonly recipientCountryCode: string;

  // Money
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: string | null;
  readonly declaredValueInr: string | null;

  // Physical
  readonly totalWeightGrams: number | null;
  readonly packageType: PackageType;

  // Flags
  readonly isUrgent: boolean;
  readonly isHighRisk: boolean;
  readonly hasAdminOverride: boolean; // god-mode marker (set-once)

  // Notes
  readonly sellerNotes: string | null;
  readonly internalNotes: string | null;
  readonly callNotes: string | null;

  // Cancellation
  readonly cancellationReason: OrderCancellationReason | null;
  readonly cancelledAt: string | null;

  // Timestamps
  readonly placedAt: string;
  readonly expectedDeliveryAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  // Children
  readonly items: readonly OrderItemView[];
  readonly events: readonly OrderEventView[];
}

export interface AdminCancelOrderRequest {
  readonly cancellationReason?: OrderCancellationReason;
  readonly note?: string;
}

export interface TransitionStatusResult {
  readonly orderId: string;
  readonly fromStatus: OrderStatus;
  readonly status: OrderStatus;
  readonly reservationOutcome: 'RESERVED' | 'OUT_OF_STOCK' | 'RELEASED' | 'FULFILLED' | null;
}

/** ORD-2 god-mode whitelist (matches ForceMutationFieldsDto). */
export interface ForceMutationFields {
  readonly recipientName?: string;
  readonly recipientPhoneE164?: string;
  readonly recipientAltPhoneE164?: string;
  readonly recipientEmail?: string;
  readonly recipientAddressLine1?: string;
  readonly recipientAddressLine2?: string;
  readonly recipientLandmark?: string;
  readonly recipientCity?: string;
  readonly recipientStateProvince?: string;
  readonly recipientPostalCode?: string;
  readonly recipientCountryCode?: string;
  readonly paymentMode?: PaymentMode;
  readonly codAmountInr?: number;
  readonly declaredValueInr?: number;
  readonly totalWeightGrams?: number;
  readonly packageType?: PackageType;
  readonly isUrgent?: boolean;
  readonly isHighRisk?: boolean;
  readonly sellerNotes?: string;
  readonly internalNotes?: string;
  readonly callNotes?: string;
  readonly cancellationReason?: OrderCancellationReason;
}

export interface ForceMutationRequest {
  readonly fieldChanges?: ForceMutationFields;
  readonly targetStatus?: OrderStatus;
  readonly reason: string; // server enforces >= 30 chars
  readonly acknowledgeDataIntegrityRisk: true; // literal true required by API
}

export interface ForceMutationResult {
  readonly orderId: string;
  readonly hasAdminOverride: true; // always true after a successful forceMutate
  readonly previousStatus: OrderStatus;
  readonly newStatus: OrderStatus;
  readonly fieldsChanged: readonly string[];
}

export interface ReleaseReservationsRequest {
  readonly reason?: string;
}

export interface ReleaseReservationsResult {
  readonly orderId: string;
  readonly releasedCount: number;
}
