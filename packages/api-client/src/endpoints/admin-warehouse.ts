/**
 * Admin warehouse-ops endpoint types — pick / pack / manifest / RTO /
 * courier dispatch / manual placement.
 *
 * Mirrors apps/api's service-layer result interfaces. Date fields are
 * serialized as ISO strings over the wire (Nest's default class-
 * serializer returns Date via toJSON() = ISO string).
 */
import type {
  ManifestStatus,
  OrderStatus,
  RtoDisposition,
  RtoItemCondition,
  ShipmentStatus,
} from '@skydrop/db';

// ── Pick ─────────────────────────────────────────────────────────────

export interface PulledPickItem {
  readonly shipmentItemId: string;
  readonly orderItemId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly quantity: number;
  readonly unitWeightGrams: number | null;
}

export interface PulledPick {
  readonly pickId: string;
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly orderId: string;
  readonly pickStartedAt: string;
  readonly pickExpiresAt: string;
  readonly items: ReadonlyArray<PulledPickItem>;
  readonly order: unknown;
}

export interface PickAllocationSummary {
  readonly reservationId: string;
  readonly orderItemId: string;
  readonly strategy: string;
  readonly allocatedQty: number;
  readonly shortfall: number;
}

export interface StartPickResult {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly fullyAllocated: boolean;
  readonly allocations: ReadonlyArray<PickAllocationSummary>;
}

export interface RecordPickItemRequest {
  readonly shipmentItemId: string;
  readonly pickedBinId: string;
  readonly pickedBatchId: string;
}

export interface RecordPickItemResult {
  readonly shipmentItemId: string;
  readonly pickedBinId: string;
  readonly pickedBatchId: string;
}

export interface CompletePickResult {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly pickCompletedAt: string;
  readonly alreadyComplete: boolean;
}

// ── Pack ─────────────────────────────────────────────────────────────

export interface PulledPackItem {
  readonly shipmentItemId: string;
  readonly orderItemId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly quantity: number;
  readonly unitWeightGrams: number | null;
  readonly pickedBinId: string | null;
  readonly pickedBatchId: string | null;
}

export interface PulledPack {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly orderId: string;
  readonly pickCompletedAt: string | null;
  readonly items: ReadonlyArray<PulledPackItem>;
  readonly order: unknown;
}

export interface CompletePackResult {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly status: ShipmentStatus;
  readonly packCompletedAt: string;
  readonly alreadyComplete: boolean;
  /** The DRAFT manifest the parcel auto-attached to (WMS-7). Null when
   *  the attach has not happened — it is post-commit and best-effort. */
  readonly manifestId: string | null;
  readonly manifestNumber: string | null;
  /** R4 — serialized units moved PICKED → PACKED; 0 for a parcel that
   *  carries none. */
  readonly unitsScanned: number;
}

// ── Manifest ─────────────────────────────────────────────────────────

export interface ManifestListRow {
  readonly id: string;
  readonly manifestNumber: string;
  readonly status: ManifestStatus;
  readonly courierCode: string;
  readonly originWarehouseId: string;
  readonly closedAt: string | null;
  readonly closedByStaffId: string | null;
  readonly createdAt: string;
  readonly shipmentCount: number;
}

export interface ManifestDetail extends ManifestListRow {
  readonly shipments: ReadonlyArray<{
    readonly id: string;
    readonly shipmentNumber: string;
    readonly status: ShipmentStatus;
    readonly packCompletedAt: string | null;
    readonly orderId: string | null;
  }>;
}

export interface ListManifestsQuery {
  readonly status?: ManifestStatus;
  readonly courierCode?: string;
  readonly warehouseId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface ListManifestsResponse {
  readonly items: ReadonlyArray<ManifestListRow>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface CloseManifestResult {
  readonly manifestId: string;
  readonly manifestNumber: string;
  readonly status: ManifestStatus;
  readonly closedAt: string;
  readonly closedByStaffId: string;
  readonly shipmentIds: ReadonlyArray<string>;
  readonly transitionedCount: number;
  readonly failures: ReadonlyArray<{
    readonly shipmentId: string;
    readonly orderId: string | null;
    readonly error: string;
  }>;
  readonly alreadyClosed: boolean;
}

export interface MoveShipmentRequest {
  readonly targetManifestId: string;
}

/**
 * Names taken from `ManifestService.moveShipment`'s actual return, not
 * from what reads naturally. All three used to differ from the wire
 * (`fromManifestId` / `toManifestId` / `alreadyMoved`), and because this
 * is a RESPONSE type nothing failed: the reads just produced `undefined`,
 * so the idempotent no-op reported to the operator as a real move.
 */
export interface MoveShipmentResult {
  readonly shipmentId: string;
  readonly sourceManifestId: string;
  readonly targetManifestId: string;
  /** true ⇒ the shipment was already on the target DRAFT; nothing moved. */
  readonly alreadyOnTarget: boolean;
}

// ── Dispatch ─────────────────────────────────────────────────────────

export interface ConfirmHandoffResult {
  readonly manifestId: string;
  readonly manifestNumber: string;
  readonly manifestStatus: ManifestStatus;
  readonly dispatchedShipmentIds: ReadonlyArray<string>;
  readonly failures: ReadonlyArray<{
    readonly shipmentId: string;
    readonly error: string;
  }>;
  readonly alreadyDispatched: boolean;
}

// ── Manual placement ────────────────────────────────────────────────

export interface PlaceManualAwbRequest {
  readonly awbNumber: string;
  /** The actual carrier (Bluedart / DTDC / …). The shipment's
   *  courierCode becomes the generic `manual`; this is the ops record of
   *  who really has the parcel. */
  readonly courierName?: string;
  /** `serviceType`, NOT `trackingUrl`. This type said trackingUrl, which
   *  PlaceManualAwbDto does not accept — and the API runs
   *  forbidNonWhitelisted, so sending it was a guaranteed 400. It went
   *  unnoticed because the hooks had no caller until the screen existed. */
  readonly serviceType?: string;
}

export interface PlaceManualAwbResult {
  readonly shipmentId: string;
  readonly awbNumber: string;
  readonly orderStatus: OrderStatus;
}

export interface CancelManualPlacementRequest {
  readonly reason: string;
}

// ── RTO ──────────────────────────────────────────────────────────────

export interface RtoShipmentItem {
  readonly shipmentItemId: string;
  readonly orderItemId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly quantity: number;
  readonly rtoCondition: RtoItemCondition | null;
  readonly rtoDisposition: RtoDisposition | null;
  readonly rtoInspectionNotes: string | null;
}

export interface RtoShipmentDetail {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly orderId: string | null;
  readonly orderStatus: OrderStatus | null;
  readonly awbNumber: string | null;
  readonly rtoReceivedAt: string | null;
  readonly items: ReadonlyArray<RtoShipmentItem>;
}

export interface ReceiveRtoRequest {
  readonly awbNumber: string;
}

export interface ReceiveRtoResult {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly orderStatus: OrderStatus;
  readonly rtoReceivedAt: string;
  readonly alreadyReceived: boolean;
}

export interface InspectRtoItemRequest {
  readonly condition: RtoItemCondition;
  readonly disposition: RtoDisposition;
  readonly notes?: string;
}

export interface InspectRtoItemResult {
  readonly shipmentItemId: string;
  readonly condition: RtoItemCondition;
  readonly disposition: RtoDisposition;
}

export interface FinalizeRtoResult {
  readonly shipmentId: string;
  readonly orderId: string;
  readonly orderStatus: OrderStatus;
  readonly restockedLines: number;
  readonly writtenOffLines: number;
  readonly alreadyFinalized: boolean;
}
