import type { ShipmentStatus } from '@skydrop/db';

/**
 * Module 9 — the Delhivery ADAPTER INTERFACE.
 *
 * These types are defined by what SKYDROP'S CODE needs, NOT by
 * Delhivery's wire contract (which is not reliably known at build
 * time — see TODO(delhivery-api) seams in the implementation). The
 * courier-awb / courier-dispatch orchestration is built + tested
 * entirely against this interface with the adapter mocked; the real
 * wire mapping is validated separately against Delhivery's sandbox
 * with credentials.
 */

/** Per-shipment input for AWB generation — marshalled by AwbGenerationService
 *  from the order + shipment snapshot (R3 snapshot-DTO discipline). */
export interface DelhiveryAwbRequest {
  shipmentNumber: string;
  recipientName: string;
  recipientPhoneE164: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  totalWeightGrams: number;
  declaredValueInr: string;
  /** null ⇒ prepaid; non-null ⇒ COD with this collectible amount. */
  codAmountInr: string | null;
  itemDescription: string;
}

export interface DelhiveryAwbSuccess {
  ok: true;
  awbNumber: string;
  courierShipmentId: string;
  /** A label URL when Delhivery returns one inline; null when the label
   *  must be fetched separately via fetchLabel. */
  labelUrl: string | null;
}

export interface DelhiveryAwbFailure {
  ok: false;
  /** false ⇒ Delhivery rejected the destination as non-serviceable
   *  (CUR-5 reactive serviceability → auto-supersede → manual placement);
   *  true ⇒ a transient/other failure (retryable per CUR-2). */
  serviceable: boolean;
  errorCode: string;
  errorMessage: string;
}

export type DelhiveryAwbResult = DelhiveryAwbSuccess | DelhiveryAwbFailure;

export interface DelhiveryLabelResult {
  /** Raw label bytes (PDF) — our code uploads them to Spaces (CUR-6). */
  bytes: Buffer;
  mimeType: string;
}

export interface DelhiveryServiceabilityResult {
  serviceable: boolean;
  /** true ⇒ the answer came from a real Delhivery call; false ⇒ stub
   *  mode (the result is an optimistic assumption, not authoritative —
   *  CUR-5 says serviceability truth is the AWB-generation response). */
  fromLiveApi: boolean;
}

/**
 * Module 10 — a raw Delhivery scan payload, post-parse but
 * pre-normalize. The shape here is OUR adapter interface — what
 * normalizeScan accepts. The actual JSON field names Delhivery emits
 * are TODO(delhivery-api); the tracking-ingestion processor (commit 8)
 * marshals from the parsed webhook body into this shape before
 * calling normalizeScan.
 */
export interface DelhiveryRawScan {
  /** AWB number the scan applies to. */
  awbNumber: string;
  /** Raw courier scan code — preserved on tracking_events for audit
   *  and TODO(delhivery-api) sandbox-validation reference. */
  rawStatus: string;
  /** Courier-reported scan timestamp (ISO 8601). The processor stamps
   *  tracking_events.event_at with this exact value (TRK-3 — scan
   *  time, not receive time). */
  eventAtIso: string;
  /** Optional location strings — passed through to tracking_events. */
  locationName?: string | null;
  locationCity?: string | null;
  locationPincode?: string | null;
  /** Optional courier-emitted narrative for the scan (e.g. "Out for
   *  delivery from BLR_HUB"). Surfaced on tracking_events.description. */
  description?: string | null;
  /** When normalized = DELIVERY_ATTEMPTED, an optional reason code
   *  the processor maps onto delivery_attempts.failure_reason. */
  failureReason?: string | null;
}

/**
 * Module 10 — normalizeScan returns either a ShipmentStatus the
 * mapping service then converts to an OrderStatus transition, OR
 * `null` for an unmappable raw code (the processor stores the raw
 * scan as a tracking_event for audit but emits no order transition).
 *
 * Why ShipmentStatus and not a parallel "CourierTrackingStatus" enum:
 * the schema already enumerates exactly these scan outcomes in
 * ShipmentStatus, and TrackingEvent.status is ShipmentStatus by
 * design. F2 (M10 pre-flight): reuse the enum + put the discipline
 * in the mapping service's EXHAUSTIVE allowlist.
 */
export type NormalizedScan =
  | {
      kind: 'NORMALIZED';
      /** ShipmentStatus subset the scan asserts (the M10 mapping
       *  service exhaustively maps each value to an OrderStatus
       *  transition or "informational"). */
      shipmentStatus: ShipmentStatus;
    }
  | {
      kind: 'UNMAPPABLE';
      /** Stub / real-mode reason — e.g. "STUB_UNKNOWN_CODE". The
       *  processor records the raw scan on tracking_events with
       *  source=COURIER_WEBHOOK + this reason in metadata, then
       *  emits NO order transition. */
      reason: string;
    };

/**
 * The adapter surface the courier-awb / courier-dispatch /
 * tracking-ingestion modules depend on. Implemented by the
 * courier-delhivery services (DelhiveryAwbService /
 * DelhiveryLabelService / DelhiveryServiceabilityService /
 * DelhiveryTrackingService); mocked wholesale in their tests.
 */
export interface DelhiveryClient {
  generateAwb(req: DelhiveryAwbRequest): Promise<DelhiveryAwbResult>;
  fetchLabel(awbNumber: string): Promise<DelhiveryLabelResult>;
  checkServiceability(pincode: string): Promise<DelhiveryServiceabilityResult>;
  /** Module 10 — translate a raw Delhivery scan into the normalized
   *  ShipmentStatus the mapping service consumes. STUB MODE uses a
   *  deterministic raw-code table (DLV-* prefix); real-mode mapping
   *  is TODO(delhivery-api). */
  normalizeScan(raw: DelhiveryRawScan): NormalizedScan;
}
