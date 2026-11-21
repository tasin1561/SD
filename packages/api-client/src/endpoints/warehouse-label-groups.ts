/**
 * Automatic label groups + "print the groups I ticked".
 *
 * GET  /admin/warehouse/printing/label-groups?warehouseId=
 * POST /admin/warehouse/printing/label-groups/print
 *
 * Mirrors apps/api `label-group.service.ts`. ISO strings over the wire.
 */
export interface LabelGroup {
  /** Stable for the same contents (courier + warehouse + first parcel). */
  key: string;
  courierCode: string;
  courierName: string;
  warehouseId: string;
  /** e.g. "Delhivery · Group 2". */
  label: string;
  size: number;
  /** Oldest order first. */
  shipmentIds: string[];
  oldestPlacedAt: string | null;
}

export interface LabelGroupList {
  /** The `warehouse.print_group_size` setting in force. */
  groupSize: number;
  totalParcels: number;
  groups: LabelGroup[];
}

export interface PrintLabelGroupsRequest {
  /** Union of the chosen groups' shipmentIds (max 1000). */
  shipmentIds: string[];
  /** A fresh random value per click (8-100 chars). */
  idempotencyKey: string;
}

export interface PrintLabelGroupsResult {
  batchId: string;
  /** e.g. "PB-2026-11-000042" — also printed on every label. */
  batchNumber: string;
  /** Null on an idempotent replay: the first response carried the file. */
  pdfBase64: string | null;
  fileName: string | null;
  shipmentCount: number;
  pageCount: number;
  /** Parcels whose label could not be produced. Named, never dropped. */
  failed: Array<{ shipmentId: string; shipmentNumber: string; reason: string }>;
  replayed: boolean;
}
