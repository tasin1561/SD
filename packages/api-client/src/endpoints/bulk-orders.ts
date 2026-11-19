/**
 * Bulk order actions, Phase A (read-only and non-money). All POST.
 *
 *   /seller/orders/bulk/confirmation-calls   perm: orders.create
 *   /seller/orders/bulk/confirm-without-call perm: orders.create
 *   /seller/orders/bulk/export               perm: orders.view   -> text/csv
 *   /seller/orders/bulk/invoices             perm: charges.view  -> application/pdf
 *   /store/orders/bulk/export                perm: orders.view   -> text/csv
 *                                            (member store AND associate; scope is the caller's)
 *   /admin/orders/bulk/confirmation-calls    perm: callcenter.queue.manage
 *   /admin/orders/bulk/confirm-without-call  perm: callcenter.queue.manage
 *   /admin/orders/bulk/export                perm: orders.view   -> text/csv
 *   /admin/orders/bulk/labels                perm: warehouse.pick -> application/pdf
 *
 * Selection caps: 1..200 ids (export: 5000) — beyond that the server answers
 * 400, it never truncates. Downloads send `Content-Disposition` and, for the
 * ones that leave orders out, `X-Bulk-Skipped` (and `X-Bulk-Exported` /
 * `X-Bulk-Included`). Orders left out of a PDF are also listed on its last page.
 */
export type BulkOutcome = 'DONE' | 'SKIPPED' | 'FAILED';

export interface BulkOrderResult {
  readonly orderId: string;
  /** null for an id the caller does not own. */
  readonly orderNumber: string | null;
  readonly outcome: BulkOutcome;
  /** The server's code for a SKIPPED / FAILED row, e.g. NOT_FOUND, OUT_OF_STOCK. */
  readonly code?: string;
  /** The server's own words — show verbatim. */
  readonly message?: string;
}

export interface BulkOrderResponse {
  readonly results: readonly BulkOrderResult[];
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
}

/** Body of every bulk action that takes a hand-picked selection (1..200). */
export interface BulkOrderIdsBody {
  readonly orderIds: readonly string[];
}

/**
 * Body of a bulk export: EXACTLY ONE of `orderIds` (1..5000) or `filter`,
 * which is the same query object that console's list endpoint takes
 * (`page` / `pageSize` are ignored). "All N matching" is `{ filter }`.
 */
export interface BulkExportBody<F> {
  readonly orderIds?: readonly string[];
  readonly filter?: F;
}

export const BULK_MAX_ORDERS = 200;
export const BULK_MAX_EXPORT = 5000;
