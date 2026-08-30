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

  /**
   * A REVERSE shipment — collected from the customer and brought back
   * to us — rather than a forward one.
   *
   * Delhivery creates both through this same endpoint; the difference
   * is `payment_mode: "Pickup"` instead of COD/Prepaid, which their
   * docs state plainly. Their pickup requests for reverse shipments are
   * scheduled automatically, so unlike a forward parcel this needs no
   * second call.
   *
   * The addresses stay as they are: for a reverse leg the "recipient"
   * fields are where the parcel is COLLECTED, and the account's pickup
   * location is where it goes. Swapping them here would be marshalling
   * the caller's intent twice.
   */
  isReverse?: boolean;

  // ── D4: the rest of the documented create payload. All optional, but
  // Delhivery's docs say to send everything available — the fields are
  // "good to have for optimal processing", and several of them decide
  // how the parcel is handled rather than merely describing it.
  /** A pooled AWB. Omit and Delhivery assigns one (and we lose the
   *  pre-allocation the pool exists to provide). */
  waybill?: string;
  /** Pieces in the box; Delhivery defaults it to 1. */
  quantity?: number;
  /** 'Surface' (default, cheaper) or 'Express'. */
  shippingMode?: 'Surface' | 'Express';
  /** 'D' standard, 'F' next-day. Distinct from shippingMode. */
  transportSpeed?: 'D' | 'F';
  /** Physical dimensions, cm — used for volumetric weight (divisor 5000). */
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  fragile?: boolean;
  dangerousGood?: boolean;
  plasticPackaging?: boolean;
  /** 'home' | 'office' — affects delivery attempt timing. */
  addressType?: string;
  /** The SELLER on whose behalf we ship; appears on the label. */
  sellerName?: string;
  sellerAddress?: string;
  sellerInvoiceNumber?: string;
  /** Required for consignments over ₹50 000 (Indian e-way bill rules). */
  ewaybillNumber?: string;
  /** Where a failed delivery returns to, if not the pickup location. */
  returnName?: string;
  returnAddress?: string;
  returnCity?: string;
  returnState?: string;
  returnPin?: string;
  returnPhone?: string;
  returnCountry?: string;
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
  /**
   * Delhivery's StatusType — the JOURNEY LEG, and the half of the
   * mapping that the status string alone cannot supply. `UD` forward,
   * `RT` return-to-origin, `PP`/`PU` reverse pickup, `DL` a terminal,
   * `CN` cancellation. "In Transit" under UD and under RT mean opposite
   * directions, so a mapping that ignores this walks orders forward
   * while the parcel is coming back.
   */
  statusType?: string | null;
  /**
   * NSL (Net Service Level) code, e.g. `X-UCI`, `EOD-74`. The
   * fine-grained reason under a status. `EOD-*` on a forward leg is how
   * a failed delivery attempt actually presents, and the specific code
   * decides whether an NDR re-attempt is even permitted.
   */
  nslCode?: string | null;
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
 * Module 10 (poll) — the parsed tracking result for a single AWB, as
 * returned by `fetchTracking`. `scans` is the courier's scan history
 * for the AWB, marshalled into our `DelhiveryRawScan` shape and sorted
 * oldest-first (the poll service applies each scan newer than the
 * shipment's tracking-event watermark, in order).
 */
/**
 * The facts a courier states about the parcel ITSELF, as opposed to the
 * scans describing its journey.
 *
 * ── WHY THIS IS SEPARATE FROM THE SCANS ──────────────────────────────
 * A scan says where the parcel was at a moment. These say what the
 * parcel IS — what it weighs once they put it on their belt, what they
 * will collect at the door, when they now expect to deliver it. They
 * change rarely and each one supersedes the last, so they belong on the
 * shipment row rather than as another line in a timeline.
 *
 * EVERY field is optional, and that is the design rather than laziness:
 * these are read defensively out of a response whose exact shape varies
 * by account and by how far along the parcel is. A missing field means
 * "they have not told us yet", which is different from zero — a
 * chargeable weight of 0 would be a free parcel and an ETA of the epoch
 * would be a promise we already broke.
 */
export interface CourierParcelFacts {
  /** What the courier will actually BILL us for, once weighed on their
   *  belt. Frequently differs from what the seller declared, and it is
   *  their number that appears on the invoice. */
  chargedWeightGrams?: number | null;
  /** When they now expect to deliver. Moves as the parcel travels. */
  expectedDeliveryAt?: Date | null;
  /** What they committed to at booking. Distinct from expected: the
   *  gap between the two is the delay, and averaging it is how a
   *  courier's reliability becomes a number rather than a feeling. */
  promisedDeliveryAt?: Date | null;
  /** When it was physically collected from us. */
  pickedUpAt?: Date | null;
  /** What they will collect at the door. OUR record of the COD is what
   *  we bill on, but THIS is what the customer will be asked for, and
   *  a disagreement between them is worth surfacing rather than
   *  discovering from a remittance that is short. */
  collectableAmountInr?: string | null;
  /** Their routing code — the facility path the parcel is booked on. */
  sortCode?: string | null;
  /** The courier's own current status line, verbatim. */
  currentStatus?: string | null;
  currentStatusLocation?: string | null;
  currentInstructions?: string | null;
}

export interface CourierTrackingResult {
  awbNumber: string;
  scans: DelhiveryRawScan[];
  /**
   * Parcel-level facts, when the courier stated any. Optional so a
   * source that only produces scans (a webhook push, a stub) does not
   * have to invent an empty object.
   */
  facts?: CourierParcelFacts;
}

/**
 * The adapter surface the courier-awb / courier-dispatch /
 * tracking-ingestion / tracking-poll modules depend on. Implemented by
 * the courier-delhivery services (DelhiveryAwbService /
 * DelhiveryLabelService / DelhiveryServiceabilityService /
 * DelhiveryTrackingService / DelhiveryTrackingFetchService); mocked
 * wholesale in their tests.
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
  /** Module 10 (poll) — fetch current tracking + scan history for up
   *  to 50 AWBs. STUB MODE returns `[]` (the poller is a no-op with no
   *  network). REAL MODE calls Delhivery's `GET /api/v1/packages/json`
   *  and marshals `ShipmentData[].Shipment.Scans[]` into raw scans. */
  fetchTracking(awbNumbers: string[]): Promise<CourierTrackingResult[]>;
}
