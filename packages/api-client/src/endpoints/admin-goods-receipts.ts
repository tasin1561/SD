/**
 * Admin goods-receipts endpoint types.
 *
 * Mirrors apps/api GoodsReceiptService's enriched view (commit added
 * variant + seller projections to the include alongside the line
 * fields the seller flow already exposed).
 */
import type { GoodsReceiptStatus } from '@skydrop/db';

export interface GoodsReceiptLineView {
  readonly id: string;
  readonly variantId: string;
  readonly batchId: string | null;
  readonly expectedQty: number;
  readonly receivedQty: number | null;
  readonly damagedQty: number | null;
  readonly unitCostInr: string | null;
  readonly manufacturedAt: string | null;
  readonly expiresAt: string | null;
  readonly putawayBinId: string | null;
  /** First image of the variant, presigned. Null when it has none. */
  readonly primaryImageUrl: string | null;
  readonly variant: {
    readonly skuCode: string;
    readonly variantLabel: string | null;
    readonly product: { readonly name: string };
  };
  /** Stamped at completion; null before. Shown by CODE, not id. */
  readonly batch: { readonly batchCode: string } | null;
  readonly putawayBin: { readonly code: string } | null;
}

export interface GoodsReceiptView {
  readonly id: string;
  readonly receiptNumber: string;
  readonly status: GoodsReceiptStatus;
  readonly sellerId: string;
  readonly warehouseId: string;
  readonly expectedArrivalAt: string | null;
  readonly sellerReference: string | null;
  /**
   * The REAL columns. This carried `startedReceivingAt`, `completedAt`
   * and `receivingStaffId` — three names the goods_receipts table has
   * never had, so the detail page's "Started" and "Completed" fields
   * read `undefined` and printed "—" on every receipt, finished ones
   * included. `receivedAt` is stamped at completion and `receivedById`
   * at start-receiving, which is the pair that actually exists.
   */
  readonly receivedAt: string | null;
  readonly receivedById: string | null;
  readonly hasDiscrepancies: boolean;
  readonly discrepancyNotes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly seller: {
    readonly id: string;
    readonly companyName: string;
    readonly email: string;
  };
  readonly warehouse: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  };
  /** Null until somebody starts receiving. StaffUser carries no display
   *  name, so the email is the readable handle. */
  readonly receivedBy: {
    readonly id: string;
    readonly email: string;
    readonly emailDisplay: string | null;
  } | null;
  readonly lines: ReadonlyArray<GoodsReceiptLineView>;
}

export interface AdminGoodsReceiptListResponse {
  readonly items: ReadonlyArray<GoodsReceiptView>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ListAdminGoodsReceiptsQuery {
  readonly sellerId?: string;
  readonly warehouseId?: string;
  readonly status?: GoodsReceiptStatus;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface RecordReceiptLineInput {
  readonly lineId: string;
  readonly receivedQty: number;
  readonly damagedQty?: number;
  readonly putawayBinId?: string;
  readonly manufacturedAt?: string;
  readonly expiresAt?: string;
  readonly unitCostInr?: number;
}
