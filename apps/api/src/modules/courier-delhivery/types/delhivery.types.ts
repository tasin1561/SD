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
 * The adapter surface the courier-awb / courier-dispatch modules depend
 * on. Implemented by the courier-delhivery services
 * (DelhiveryAwbService / DelhiveryLabelService /
 * DelhiveryServiceabilityService); mocked wholesale in their tests.
 */
export interface DelhiveryClient {
  generateAwb(req: DelhiveryAwbRequest): Promise<DelhiveryAwbResult>;
  fetchLabel(awbNumber: string): Promise<DelhiveryLabelResult>;
  checkServiceability(pincode: string): Promise<DelhiveryServiceabilityResult>;
}
