/**
 * Two-leg consignment types — shared by apps/seller and apps/admin.
 *
 * A consignment is the seller's stock journey: announced, counted at up to
 * two stops, labelled at ONE of them, and finally landed in India. See
 * docs/consignment-two-leg.md.
 */
import type {
  ConsignmentEventType,
  ConsignmentLeg,
  ConsignmentRoute,
  ConsignmentStatus,
  InboundFreightMode,
  LabelReprintRequestStatus,
  GoodsReceiptStatus,
  LabellingSite,
} from '@skydrop/db';

export interface ConsignmentLegLineView {
  readonly id: string;
  readonly variantId: string;
  readonly expectedQty: number;
  readonly receivedQty: number | null;
  readonly damagedQty: number | null;
  readonly batchId: string | null;
  readonly variant: {
    readonly skuCode: string;
    readonly variantLabel: string | null;
    readonly product: { readonly name: string };
  };
}

export interface ConsignmentLegView {
  readonly id: string;
  readonly receiptNumber: string;
  readonly leg: ConsignmentLeg | null;
  readonly status: GoodsReceiptStatus;
  readonly warehouseId: string;
  /** Set on an India leg once it has left Bangladesh. */
  readonly dispatchedAt: string | null;
  /**
   * The Bangladesh stop handled this and sent it on WITHOUT opening it.
   * Not a count of zero and not a discrepancy — nobody looked, so there
   * is no number and no difference. India becomes the first count.
   */
  readonly forwardedWithoutCount: boolean;
  readonly receivedAt: string | null;
  readonly hasDiscrepancies: boolean;
  readonly discrepancyNotes: string | null;
  readonly warehouse: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly countryCode: string;
  };
  readonly lines: readonly ConsignmentLegLineView[];
}

export interface ConsignmentView {
  readonly id: string;
  readonly consignmentNumber: string;
  readonly sellerId: string;
  readonly route: ConsignmentRoute;
  readonly status: ConsignmentStatus;
  readonly labellingSite: LabellingSite;
  /** Non-null means the labelling station is locked. */
  readonly labelsPrintedAt: string | null;
  readonly expectedArrivalAt: string | null;
  readonly sellerReference: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  /**
   * This consignment's own PIN for how its freight is paid for, or null
   * when nobody has made a per-shipment decision about it — which is
   * most of them.
   *
   * NOT the answer on its own: a null falls through to the seller's
   * override and then the global default, and only
   * `GET /admin/consignments/:id/freight-mode` walks that chain. Read
   * this for "has somebody pinned this one", never for "how is it
   * billed".
   */
  readonly inboundFreightMode: InboundFreightMode | null;
  readonly createdAt: string;
  readonly seller: {
    readonly id: string;
    readonly companyName: string;
    readonly emailDisplay: string;
  };
  readonly receipts: readonly ConsignmentLegView[];
  /**
   * LIVE freight bills, one per ARRIVAL — a consignment that lands in two
   * shipments is invoiced twice, because that is how a forwarder bills.
   *
   * A WITHDRAWN bill is NOT here: it gave its money back, so summing or
   * listing it beside a live one shows a charge that nobody owes. The
   * server filters it (`CONSIGNMENT_INCLUDE`) rather than leaving each
   * reader to remember, and the withdrawal is on the consignment TIMELINE
   * where the history belongs. The full record — what was agreed, in which
   * currency, the per-line rates, withdrawn bills — is the freight
   * endpoint; this list stays a summary.
   */
  readonly freightCharges: readonly {
    readonly id: string;
    readonly status: string;
    readonly totalInr: string;
    readonly goodsReceiptId: string;
  }[];
}

export interface ConsignmentEventView {
  readonly id: string;
  readonly type: ConsignmentEventType;
  readonly description: string | null;
  readonly data: unknown;
  readonly createdAt: string;
}

export interface DeclareConsignmentBody {
  readonly route: ConsignmentRoute;
  readonly expectedArrivalAt?: string;
  readonly sellerReference?: string;
  readonly lines: ReadonlyArray<{
    readonly variantId: string;
    readonly expectedQty: number;
    readonly unitCostInr?: number;
    readonly manufacturedAt?: string;
    readonly expiresAt?: string;
  }>;
}

export interface DispatchToIndiaBody {
  /** Omit when `withoutCounting` — the whole declaration travels. */
  readonly lines?: ReadonlyArray<{ readonly lineId: string; readonly quantity: number }>;
  /** Forward it on the declared quantities, without opening it. */
  readonly withoutCounting?: boolean;
  readonly etaAt?: string;
  readonly reference?: string;
}

export interface DispatchResult {
  readonly legReceiptId: string;
  readonly legReceiptNumber: string;
  readonly unitsDispatched: number;
  readonly lines: ReadonlyArray<{ readonly variantId: string; readonly quantity: number }>;
}

export interface CancelConsignmentResult {
  readonly unitsReturned: number;
  readonly serialsReturned: number;
}

export interface LabelPreview {
  readonly site: LabellingSite;
  readonly locked: boolean;
  readonly strictUnits: number;
  readonly strictSkus: number;
}

export interface LabelSheet {
  readonly consignmentNumber: string;
  readonly site: LabellingSite;
  readonly printedAt: string;
  readonly labels: ReadonlyArray<{
    readonly serialBarcode: string;
    readonly skuCode: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly expiresAt: string | null;
    /** Code 128 module widths for the serial, encoded server-side.
     *  Null when the serial cannot be carried by Code 128 subset B, in
     *  which case the sheet prints the string alone. */
    readonly barcodeWidths: readonly number[] | null;
  }>;
}

/**
 * LBL-5b — where a label reprint request stands. `EXPIRED` is an approval
 * more than 24 hours old: derived on read, never stored.
 */
export type LabelReprintState = LabelReprintRequestStatus | 'EXPIRED';

/** One request to reprint named units' serial labels (two people). */
export interface LabelReprintRequestView {
  readonly id: string;
  readonly consignmentId: string;
  readonly consignmentNumber: string;
  readonly serials: readonly string[];
  readonly reason: string;
  readonly state: LabelReprintState;
  readonly requestedBy: { readonly id: string; readonly email: string | null };
  readonly requestedAt: string;
  readonly decidedBy: { readonly id: string; readonly email: string | null } | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  /** When an approval stops being printable; null unless approved. */
  readonly approvalExpiresAt: string | null;
  readonly printedAt: string | null;
}

export interface ConsignmentListResult {
  readonly items: readonly ConsignmentView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
