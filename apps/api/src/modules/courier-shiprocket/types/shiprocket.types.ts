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
  /**
   * RS-10 — the business the customer bought from, on a reseller-store
   * order ONLY. An optional field of their adhoc create; never sent for
   * any other order, so those bodies are unchanged. Display only — the
   * pickup location (what they match on) is untouched.
   */
  readonly reseller_name?: string;
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

/**
 * `/orders/create/return` — the RETURN leg.
 *
 * ── THE NAMING INVERTS, AND THAT IS THE WHOLE TRAP ───────────────────
 * On their FORWARD create, `billing_*` is the recipient and the pickup
 * location is ours. On a RETURN it is the other way round: `pickup_*` is
 * where the van goes to COLLECT — the customer — and `shipping_*` is
 * where the goods are delivered to, which is us. Getting that backwards
 * does not error; it books a van to our own warehouse to collect from
 * ourselves while the customer keeps the goods, which is exactly the
 * outcome `REVERSE_NOT_SUPPORTED` was refusing rather than risking.
 *
 * Note there is NO `pickup_location` on a return: a registered location
 * name is a place THEY collect from, and on a return that is the
 * customer's door, so the address is spelled out instead. Ours has to be
 * spelled out too — which is why it comes from a setting (we hold no
 * address on the `warehouses` row; see
 * `CourierWarehouseRegistrationService`'s note on exactly that).
 */
export interface ShiprocketCreateReturnRequest {
  readonly order_id: string;
  readonly order_date: string;
  /** WHERE THE VAN GOES — the customer. */
  readonly pickup_customer_name: string;
  readonly pickup_last_name: string;
  readonly pickup_address: string;
  readonly pickup_address_2: string;
  readonly pickup_city: string;
  readonly pickup_state: string;
  readonly pickup_country: string;
  readonly pickup_pincode: number;
  readonly pickup_email: string;
  readonly pickup_phone: string;
  readonly pickup_isd_code: string;
  /** WHERE IT ENDS UP — our warehouse. */
  readonly shipping_customer_name: string;
  readonly shipping_last_name: string;
  readonly shipping_address: string;
  readonly shipping_address_2: string;
  readonly shipping_city: string;
  readonly shipping_country: string;
  readonly shipping_pincode: number;
  readonly shipping_state: string;
  readonly shipping_email: string;
  readonly shipping_isd_code: string;
  readonly shipping_phone: string;
  readonly order_items: readonly ShiprocketReturnOrderItem[];
  readonly payment_method: 'PREPAID';
  readonly total_discount: string;
  readonly sub_total: number;
  readonly length: number;
  readonly breadth: number;
  readonly height: number;
  /** KILOGRAMS, as on the forward create. */
  readonly weight: number;
}

/**
 * A return's line. Their return items carry `qc_enable`, which the
 * forward ones do not.
 *
 * `qc_enable: false` on purpose — quality-check-at-pickup asks the
 * driver to inspect the goods on the customer's doorstep against
 * expected values, and we have no process that produces those values or
 * acts on the verdict. Asking for a check nobody reads would delay every
 * collection and give a driver grounds to refuse one.
 */
export interface ShiprocketReturnOrderItem {
  readonly name: string;
  readonly sku: string;
  readonly units: number;
  readonly selling_price: number;
  readonly discount: string;
  readonly qc_enable: boolean;
}

/** Same shape as the forward create's reply. */
export interface ShiprocketCreateReturnResponse {
  readonly order_id: number;
  readonly shipment_id: number;
  readonly status?: string;
  readonly status_code?: number;
}

/**
 * Where a RETURN is delivered to — our warehouse, as ops recorded it.
 *
 * Not on the `warehouses` row because there is no address there at all
 * (a deliberate gap: see `CourierWarehouseRegistrationService`). Held as
 * the JSON setting `courier.shiprocket_return_address`, seeded EMPTY and
 * never guessed — an invented return address is a van delivering
 * somebody's goods to a place that does not exist.
 */
export interface ShiprocketReturnAddress {
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
  readonly phone: string;
  readonly email: string;
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
      /** Working days, when they give it as a number rather than a date. */
      readonly estimated_delivery_days?: string | number;
      readonly freight_charge?: number;
      readonly cod_charges?: number;
      readonly other_charges?: number;
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
  /** RS-10 — the reseller store the customer bought from. Sent as
   *  `reseller_name`; absent for every other order. */
  readonly resellerName?: string;
  /**
   * Book the RETURN leg: collect from `recipient`, deliver to us.
   *
   * On the SAME request rather than a parallel type, because everything
   * else about the parcel is identical — the address is where it is
   * collected instead of delivered, which is a fact about the leg and
   * not about the parcel. The client routes it to
   * `/orders/create/return` and inverts the address naming there; the
   * caller never has to swap the fields itself (the same reasoning
   * `DispatchAwbInput.isReverse` already states).
   */
  readonly isReverse?: boolean;
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
