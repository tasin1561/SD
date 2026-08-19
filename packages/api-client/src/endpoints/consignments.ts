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
  readonly createdAt: string;
  readonly seller: {
    readonly id: string;
    readonly companyName: string;
    readonly emailDisplay: string;
  };
  readonly receipts: readonly ConsignmentLegView[];
  readonly freightCharge: {
    readonly id: string;
    readonly status: string;
    readonly totalInr: string;
  } | null;
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
  }>;
}

export interface ConsignmentListResult {
  readonly items: readonly ConsignmentView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
