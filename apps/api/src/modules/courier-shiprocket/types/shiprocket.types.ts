import type { ShipmentStatus } from '@skydrop/db';
import type {
  CourierTrackingResult,
  NormalizedScan,
} from '../../courier-delhivery/types/delhivery.types';

/**
 * Shiprocket's wire contract.
 *
 * Transcribed from their published Postman collection
 * (apidocs.shiprocket.in, collection 8407119/SzYW1zB2) — the endpoints,
 * field names and response shapes below are theirs, not inferred. What
 * has NOT happened is a real call: no account is provisioned, so every
 * shape here is documented-but-unproven and the seams that could differ
 * are marked `TODO(shiprocket-api)`. That is the same position Delhivery
 * was in before 2026-07-27, and it ended the same way — with a
 * controlled first call rather than a hopeful deploy.
 *
 * ── THE STRUCTURAL DIFFERENCE FROM DELHIVERY ─────────────────────────
 * Delhivery manifests a parcel and hands back a waybill in ONE call.
 * Shiprocket takes two: create an order (`/orders/create/adhoc`, which
 * returns an `order_id` and a `shipment_id`), then assign a courier to
 * that shipment (`/courier/assign/awb`, which returns the AWB). Their
 * `shipment_id` is an identifier in THEIR system and is not our
 * `shipments.id` — it has to be stored, because the label, pickup and
 * cancel endpoints all key on it rather than on the AWB.
 *
 * Hiding that difference is the adapter's job. `generateAwb` performs
 * both calls and returns a waybill, so the AWB saga (CUR-2/CUR-9) does
 * not learn that one courier needs two round trips.
 */

/** Base URL. Their v1 external API; the docs use no other host except
 *  `serviceability.shiprocket.in` for blocked-pincode management, which
 *  we do not use. */
export const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in';

/**
 * Auth is a bearer token minted from an email and password.
 *
 * Unlike Delhivery's static per-environment token, this one EXPIRES —
 * their docs put it at ten days — so it has to be acquired, cached and
 * renewed. Logging in per request would be both slow and a good way to
 * get rate-limited on the auth endpoint specifically.
 */
export interface ShiprocketLoginResponse {
  readonly token: string;
  /** Present in their sample; not relied upon. */
  readonly first_name?: string;
  readonly email?: string;
  readonly company_id?: number;
}

export interface ShiprocketOrderItem {
  readonly name: string;
  readonly sku: string;
  readonly units: number;
  readonly selling_price: number;
  readonly hsn?: string;
}

/**
 * `/orders/create/adhoc`.
 *
 * Their field names, including the ones that read oddly:
 * `billing_*` is the RECIPIENT (not whoever pays), and
 * `shipping_is_billing: true` means "ship to the billing address",
 * which is the normal case for us — we hold one address per order.
 */
export interface ShiprocketCreateOrderRequest {
  readonly order_id: string;
  readonly order_date: string;
  readonly pickup_location: string;
  readonly billing_customer_name: string;
  readonly billing_last_name: string;
  readonly billing_address: string;
  readonly billing_address_2: string;
  readonly billing_city: string;
  readonly billing_pincode: string;
  readonly billing_state: string;
  readonly billing_country: string;
  readonly billing_email: string;
  readonly billing_phone: string;
  readonly shipping_is_billing: boolean;
  readonly order_items: readonly ShiprocketOrderItem[];
  readonly payment_method: 'COD' | 'Prepaid';
  readonly sub_total: number;
  readonly length: number;
  readonly breadth: number;
  readonly height: number;
  /** KILOGRAMS. Ours are grams everywhere — converted at the boundary. */
  readonly weight: number;
}

export interface ShiprocketCreateOrderResponse {
  readonly order_id: number;
  readonly shipment_id: number;
  readonly status: string;
  readonly status_code: number;
  readonly awb_code: string | null;
  readonly courier_company_id: number | null;
  readonly courier_name: string | null;
}

/** `/courier/assign/awb`. `courier_id` is optional — omitted, Shiprocket
 *  picks by its own rules, which is what we want until somebody sets a
 *  preference per account. */
export interface ShiprocketAssignAwbRequest {
  readonly shipment_id: number;
  readonly courier_id?: number;
}

export interface ShiprocketAssignAwbResponse {
  readonly awb_assign_status: number;
  readonly response?: {
    readonly data?: {
      readonly awb_code?: string;
      readonly courier_company_id?: number;
      readonly courier_name?: string;
      readonly shipment_id?: number;
      readonly applied_weight?: number;
    };
  };
  /** Present when they refuse. Their message is the only explanation. */
  readonly message?: string;
}

/** `/courier/generate/label`. Takes an ARRAY even for one parcel. */
export interface ShiprocketLabelResponse {
  readonly label_created: number;
  readonly label_url: string;
  readonly response: string;
  readonly not_created: readonly unknown[];
}

/** `/courier/serviceability/` — a GET with query params. */
export interface ShiprocketServiceabilityResponse {
  readonly status?: number;
  readonly data?: {
    readonly available_courier_companies?: ReadonlyArray<{
      readonly courier_company_id: number;
      readonly courier_name: string;
      readonly rate?: number;
      readonly etd?: string;
      readonly blocked?: number;
    }>;
  };
}

/** `/courier/track/awb/{awb}`. */
export interface ShiprocketTrackingResponse {
  readonly tracking_data?: {
    readonly track_status?: number;
    readonly shipment_status?: number;
    readonly shipment_track?: ReadonlyArray<{
      readonly awb_code?: string;
      readonly current_status?: string;
      readonly delivered_date?: string | null;
      readonly pickup_date?: string | null;
      readonly destination?: string;
      readonly origin?: string;
    }>;
    readonly shipment_track_activities?: ReadonlyArray<{
      readonly date?: string;
      readonly status?: string;
      readonly activity?: string;
      readonly location?: string;
      readonly 'sr-status'?: string;
      readonly 'sr-status-label'?: string;
    }>;
  };
  /** Their "nothing found" shape is an empty object, not a 404. */
  readonly message?: string;
}

export interface ShiprocketAwbRequest {
  readonly shipmentId: string;
  readonly orderNumber: string;
  readonly pickupLocationName: string;
  readonly recipient: {
    readonly name: string;
    readonly addressLine1: string;
    readonly addressLine2: string;
    readonly city: string;
    readonly state: string;
    readonly pincode: string;
    readonly phoneE164: string;
    readonly email: string | null;
  };
  readonly items: ReadonlyArray<{
    readonly name: string;
    readonly sku: string;
    readonly quantity: number;
    readonly unitPriceInr: number;
  }>;
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly subTotalInr: number;
  readonly weightGrams: number;
  readonly lengthCm: number;
  readonly breadthCm: number;
  readonly heightCm: number;
}

export type ShiprocketAwbFailure = 'NON_SERVICEABLE' | 'TRANSIENT';

export type ShiprocketAwbResult =
  | {
      readonly ok: true;
      readonly awbNumber: string;
      /** THEIR shipment id. Stored, because label/pickup/cancel key on it. */
      readonly courierShipmentId: string;
      readonly courierOrderId: string;
      readonly courierName: string | null;
    }
  | { readonly ok: false; readonly failure: ShiprocketAwbFailure; readonly message: string };

/**
 * The same capability surface as `DelhiveryClient`.
 *
 * Deliberately shaped to match: the AWB saga, the label persistence and
 * the tracking poller should not know which courier they are talking
 * to. Where the two differ — Shiprocket's two-step creation, its
 * expiring token, its numeric shipment id — the difference is absorbed
 * here rather than leaking into the orchestration.
 */
export interface ShiprocketClient {
  generateAwb(req: ShiprocketAwbRequest): Promise<ShiprocketAwbResult>;
  fetchLabel(courierShipmentId: string): Promise<{ url: string | null; message: string | null }>;
  checkServiceability(input: {
    pickupPincode: string;
    deliveryPincode: string;
    weightGrams: number;
    isCod: boolean;
  }): Promise<{ serviceable: boolean; fromLiveApi: boolean }>;
  normalizeScan(raw: { rawStatus: string; eventAtIso: string }): NormalizedScan;
  fetchTracking(awbNumbers: readonly string[]): Promise<CourierTrackingResult[]>;
  cancelShipment(awbNumber: string): Promise<{ ok: boolean; message: string | null }>;
  requestPickup(courierShipmentId: string): Promise<{ ok: boolean; message: string | null }>;
}

/**
 * Their scan vocabulary → ours.
 *
 * Shiprocket reports a human string (`current_status`) alongside a
 * numeric `shipment_status`. The strings below are the ones their
 * tracking samples and status table use. Anything unrecognised maps to
 * null and is recorded as an unmappable scan rather than guessed at —
 * inventing a DELIVERED from an unknown string is how a parcel gets
 * marked arrived because somebody mistyped a case label.
 *
 * TODO(shiprocket-api): the full vocabulary is only confirmable against
 * a live account. These are the documented ones.
 */
export const SHIPROCKET_STATUS_MAP: Readonly<Record<string, ShipmentStatus>> = {
  'awb assigned': 'AWB_GENERATED',
  'label generated': 'AWB_GENERATED',
  // Their pickup states have no equivalent of ours: the parcel is
  // still in our building, and HANDED_TO_COURIER is the closest true
  // thing we can say — a van has been booked for it.
  'pickup scheduled': 'HANDED_TO_COURIER',
  'pickup generated': 'HANDED_TO_COURIER',
  'pickup queued': 'HANDED_TO_COURIER',
  'out for pickup': 'HANDED_TO_COURIER',
  'picked up': 'IN_TRANSIT',
  shipped: 'IN_TRANSIT',
  'in transit': 'IN_TRANSIT',
  'reached at destination hub': 'AT_HUB',
  'out for delivery': 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  undelivered: 'DELIVERY_ATTEMPTED',
  'delivery delayed': 'DELIVERY_ATTEMPTED',
  'rto initiated': 'RTO_INITIATED',
  'rto in transit': 'RTO_IN_TRANSIT',
  'rto delivered': 'RTO_DELIVERED',
  'rto acknowledged': 'RTO_DELIVERED',
  lost: 'LOST',
  damaged: 'DAMAGED',
  cancelled: 'CANCELLED',
} as const;
