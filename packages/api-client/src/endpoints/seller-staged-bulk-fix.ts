/**
 * Pending orders: fix one problem across many CSV-staged rows at once.
 *
 *   GET  /seller/orders-pending/bulk-fix        (groups of the same problem + bad value)
 *   POST /seller/orders-pending/bulk-fix/apply  (set one field on every matching row)
 */
export type BulkFixField =
  | 'productSku'
  | 'state'
  | 'customerPhone'
  | 'pinCode'
  | 'paymentMode'
  | 'addressLine2';

export type BulkFixKind =
  | 'SKU_NOT_FOUND'
  | 'STATE_NOT_RECOGNISED'
  | 'PHONE_FORMAT'
  | 'PIN_FORMAT'
  | 'PAYMENT_MODE'
  | 'LANDMARK_MISSING';

export interface BulkFixSuggestion {
  /** The value to write into the field. */
  readonly value: string;
  /** What a person reads, e.g. the product name for a SKU. */
  readonly label: string;
}

export interface BulkFixGroup {
  readonly field: BulkFixField;
  readonly kind: BulkFixKind;
  /** The value the rows carry now ('' for a missing landmark). */
  readonly badValue: string;
  /** Why it is a problem, in the seller's words. */
  readonly reason: string;
  readonly rowCount: number;
  readonly rowIds: readonly string[];
  /** At most 3. Empty for kinds with no safe guess. */
  readonly suggestions: readonly BulkFixSuggestion[];
}

export interface BulkFixSummary {
  readonly groups: readonly BulkFixGroup[];
}

export interface BulkFixApplyRequest {
  readonly field: BulkFixField;
  readonly fromValue: string;
  readonly toValue: string;
  /** Narrow to these rows. Omit for every matching pending row. */
  readonly rowIds?: readonly string[];
  /** Import rows that become clean, through the same path as "Import as order". */
  readonly importAfterFix?: boolean;
}

export interface BulkFixRowResult {
  readonly rowId: string;
  readonly rowNumber: number;
  /** fixed: no problems left. stillHasProblems: changed, but more to fix. */
  readonly outcome: 'fixed' | 'stillHasProblems';
  readonly problems: ReadonlyArray<{ readonly field: string; readonly reason: string }>;
  readonly imported: boolean;
  readonly orderId: string | null;
  /** Set when importAfterFix was asked and the import was refused. */
  readonly importError: string | null;
}

export interface BulkFixApplyResult {
  /** Rows that matched field = fromValue. 0 on a repeat call. */
  readonly matched: number;
  readonly results: readonly BulkFixRowResult[];
}

/**
 * Selection-based actions (the seller ticks rows, then picks an action).
 *   GET  /seller/orders-pending/compact
 *   POST /seller/orders-pending/bulk/set-field  { rowIds, field, value, idempotencyKey }
 *   POST /seller/orders-pending/bulk/import     { rowIds, idempotencyKey }
 *   POST /seller/orders-pending/bulk/discard    { rowIds, idempotencyKey }
 * 1 to 500 rowIds; idempotencyKey is a fresh UUID per click.
 */
export type PendingSetField =
  | 'productSku'
  | 'quantity'
  | 'customerPhone'
  | 'state'
  | 'pinCode'
  | 'city'
  | 'codAmount'
  | 'landmark'
  | 'addressLine2';

export interface PendingCompactRow {
  readonly id: string;
  readonly rowNumber: number;
  readonly externalRef: string;
  readonly customerName: string;
  readonly phone: string;
  readonly pinCode: string;
  readonly sku: string;
  readonly qty: string;
  readonly codAmount: string;
  readonly problemCount: number;
  readonly status: 'NEEDS_INPUT' | 'DUPLICATE_SUSPECTED';
}

export interface PendingBulkRowResult {
  readonly rowId: string;
  /** DONE, SKIPPED (refused: not yours / not pending / import refused) or FAILED. */
  readonly outcome: 'DONE' | 'SKIPPED' | 'FAILED';
  readonly code?: string;
  /** The server's words. A set-field DONE row that still has problems says "Saved, but still needs: ...". */
  readonly message?: string;
}

export interface PendingBulkResponse {
  readonly action: string;
  readonly results: readonly PendingBulkRowResult[];
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  /** True when this is the stored answer to an identical earlier click. */
  readonly replayed: boolean;
}

export interface PendingBulkSetFieldRequest {
  readonly rowIds: readonly string[];
  readonly field: PendingSetField;
  readonly value: string;
  readonly idempotencyKey: string;
}

export interface PendingBulkIdsRequest {
  readonly rowIds: readonly string[];
  readonly idempotencyKey: string;
}
