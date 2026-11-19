/**
 * Bulk order actions — the ONE result shape every console reads.
 *
 * A bulk call never fails as a whole because one order was refused: each
 * order carries its own outcome, and the totals are derived from the rows
 * so the two can never disagree.
 *
 * `orderNumber` is only ever filled from a query that already carried the
 * caller's scope. An id the caller does not own reads SKIPPED / NOT_FOUND
 * with a null number — it says nothing about whether the row exists.
 */
export type BulkOutcome = 'DONE' | 'SKIPPED' | 'FAILED';

export interface BulkOrderResult {
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly outcome: BulkOutcome;
  /** The server's own code, for a SKIPPED / FAILED row. */
  readonly code?: string;
  /** The server's own words (FE-2: shown verbatim, never re-derived). */
  readonly message?: string;
}

export interface BulkOrderResponse {
  readonly results: readonly BulkOrderResult[];
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
}

export function summariseBulk(results: readonly BulkOrderResult[]): BulkOrderResponse {
  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of results) {
    if (r.outcome === 'DONE') done += 1;
    else if (r.outcome === 'SKIPPED') skipped += 1;
    else failed += 1;
  }
  return { results, done, skipped, failed };
}

/** Selection caps. Beyond them the request is refused 400, never truncated. */
export const BULK_MAX_ORDERS = 200;
export const BULK_MAX_EXPORT = 5000;
