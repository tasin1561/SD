/**
 * Which ORDER_CHARGES debit on an order is still owed back.
 *
 * Charges and refunds PAIR UP (2026-09-12). An order may be billed,
 * refunded, and billed again — a lost parcel is refunded and then found
 * and delivered — so "already refunded once" is not "nothing owed
 * back". The answer is the most recent charge that no refund points at,
 * and only while charges outnumber refunds.
 *
 * ── WHY IT IS A FUNCTION OF ITS OWN ──────────────────────────────────
 * `OrderChargesRefundService` reads the ORIGINAL ENTRY's amount rather
 * than re-summing `order_charges`, and says why in its own words: "re-
 * deriving it would let the two sides drift the day someone adds a
 * charge type, and the seller would be refunded a different number from
 * the one they were charged."
 *
 * The same argument applies to anything that TELLS a seller what they
 * are about to get back — the cancel dialog's money line, which existed
 * for months with nothing supplying it. A screen that worked the figure
 * out its own way would be the identical drift with a worse symptom:
 * the seller reads one number before agreeing and is credited another.
 * So the pairing lives here, once, and both sides call it.
 *
 * Pure: no Prisma, no DI. The caller supplies the rows.
 */

export interface PairableCharge {
  readonly id: string;
  /** Whatever the caller's amount type is — this function never reads it. */
  readonly amount: unknown;
}

export interface PairableRefund {
  /** The charge entry this refund returns, or null for an unlinked one. */
  readonly linkedEntryId: string | null;
}

/**
 * The charge still owed back, or null when nothing is.
 *
 * `charges` must be ordered NEWEST FIRST (the ledger's ids are uuidv7,
 * so `orderBy: { id: 'desc' }` is that order), because the newest
 * unpaired charge is the one a refund now would return.
 */
export function unrefundedCharge<C extends PairableCharge>(
  charges: readonly C[],
  refunds: readonly PairableRefund[],
): C | null {
  // Never charged — the ordinary case for an AT_DELIVERY seller.
  if (charges.length === 0) return null;
  // Every charge has been given back already.
  if (refunds.length >= charges.length) return null;
  const refunded = new Set(refunds.map((r) => r.linkedEntryId));
  return charges.find((c) => !refunded.has(c.id)) ?? null;
}
