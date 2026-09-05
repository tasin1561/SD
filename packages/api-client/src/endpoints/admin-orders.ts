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
  readonly recipientPhoneE164: string;
  /** Blank on every order placed since the form stopped asking (ORD-5). */
  readonly recipientCity: string;
  readonly recipientStateProvince: string;
  /** Always present — Delhivery routes on it, so the form still asks. */
  readonly recipientPostalCode: string;
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

/** The full admin order view — items + everything the detail screen
 *  renders. Mirrors `ORDER_VIEW_INCLUDE` on the server (M12 commit 9
 *  discovery: today this is items-only; an admin events / delivery-
 *  attempts include is a follow-up — see phase-1a-debt M12). */
export interface OrderItemView {
  readonly id: string;
  readonly variantId: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly skuCode: string;
  readonly quantity: number;
  readonly unitWeightGrams: number | null;
  readonly unitDeclaredValueInr: string | null;
  readonly unitPriceInr: string | null;
  readonly qtyReserved: number;
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
  // Events / delivery attempts are NOT on ORDER_VIEW_INCLUDE today;
  // an admin events endpoint is the M12 follow-up. The UI degrades
  // gracefully (skips the timeline) until that lands.
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

/** Per-line outcome of the attempted-not-blocking reserve on a
 *  god-mode → CONFIRMED move. Mirrors the server's
 *  `ReserveAttemptOutcome` shape. */
export interface ReserveAttemptOutcome {
  readonly orderItemId: string;
  readonly ok: boolean;
  readonly reservationId?: string;
  readonly error?: string;
}

export interface ForceMutationResult {
  readonly orderId: string;
  readonly fromStatus: OrderStatus;
  readonly status: OrderStatus;
  readonly hasAdminOverride: true; // permanent flag, set-once
  readonly fieldChangesApplied: readonly string[];
  /** Non-null only when a → CONFIRMED move attempted reservations.
   *  Each row is `{ok: true, reservationId}` or `{ok: false, error}`.
   *  The saga does NOT block on shortfall — god mode opts out of
   *  compensation. */
  readonly reserveOutcomes: readonly ReserveAttemptOutcome[] | null;
}

export interface ReleaseReservationsRequest {
  readonly reason?: string;
}

export interface ReleaseReservationsResult {
  readonly orderId: string;
  readonly releasedCount: number;
  readonly released: ReadonlyArray<{
    readonly reservationId: string;
    readonly qtyReleased: number;
    readonly alreadyInactive: boolean;
  }>;
}
