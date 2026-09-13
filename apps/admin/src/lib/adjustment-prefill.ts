/**
 * A stock adjustment opened from a known line — a bin's contents — rather
 * than typed from a count sheet.
 *
 * Plain module on purpose: the adjustments page is a server component and
 * reads the URL, the bin page is a client component and writes it, and a
 * helper exported from a 'use client' file reaches a server component as a
 * client reference rather than a function.
 */

export interface AdjustmentPrefill {
  readonly sellerId: string;
  readonly variantId: string;
  readonly binId: string;
  readonly batchId: string;
  readonly reasonCode: string;
}

/** Reasons the form offers; a prefilled reason outside this list falls back. */
export const ADJUSTMENT_REASON_CODES = [
  'COUNTING_ERROR',
  'DAMAGED_IN_WAREHOUSE',
  'DAMAGED_ON_ARRIVAL',
  'LOST',
  'FOUND_EXTRA',
  'EXPIRED',
  'RECALLED',
  // WMS-8d: a returned unit kept aside damaged leaves the Damaged bin by a
  // DECREASE — back to the seller (this), or scrapped (damaged in
  // warehouse). The API always accepted it; the form never offered it.
  'RETURNED_TO_SELLER',
  'OTHER',
] as const;

const DEFAULT_REASON = 'COUNTING_ERROR';

/** The link from one line of a bin's contents to a prefilled adjustment. */
export function adjustmentHref(line: {
  readonly sellerId: string;
  readonly variantId: string;
  readonly batchId: string;
  readonly binId: string;
  readonly binType: string;
}): string {
  const params = new URLSearchParams({
    sellerId: line.sellerId,
    variantId: line.variantId,
    binId: line.binId,
    batchId: line.batchId,
    // Stock in the Damaged bin is there to go back to the seller or be
    // scrapped; anywhere else the likeliest correction is a miscount.
    reason: line.binType === 'DAMAGED' ? 'RETURNED_TO_SELLER' : DEFAULT_REASON,
  });
  return `/inventory/adjustments?${params.toString()}`;
}

/** The prefill a URL carries, or null when it does not name a whole line. */
export function prefillFromSearchParams(sp: {
  readonly sellerId?: string;
  readonly variantId?: string;
  readonly binId?: string;
  readonly batchId?: string;
  readonly reason?: string;
}): AdjustmentPrefill | null {
  const { sellerId, variantId, binId, batchId } = sp;
  if (!sellerId || !variantId || !binId || !batchId) return null;
  const reason = sp.reason ?? DEFAULT_REASON;
  return {
    sellerId,
    variantId,
    binId,
    batchId,
    reasonCode: (ADJUSTMENT_REASON_CODES as readonly string[]).includes(reason)
      ? reason
      : DEFAULT_REASON,
  };
}
