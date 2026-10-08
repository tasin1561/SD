/**
 * ASSOC-1 — whether ONE associate's retail price for ONE product is
 * allowed. Pure: no Prisma, no clock, and in whole PAISE.
 *
 * ── WHY PAISE, AND WHY THIS IS NOT INLINE AT THE CALL SITE ───────────
 * Amounts arrive as decimal strings of at most two places. Comparing
 * them as integers is exact where comparing floats is not: `139.95`
 * against a `139.95` minimum decides a sale, and in binary doubles that
 * comparison is one representation error away from refusing a price that
 * is precisely on the boundary. `toPaise` is reused from RS-3's own
 * price rules rather than written again — a second "rupee string to
 * integer" is how the two come to disagree about `1.005`.
 *
 * Three callers need this answer and must give the same one: the
 * reseller setting a price by hand, the copy-from bulk write, and (later)
 * the order create that fixes the retail from the associate's row. Three
 * copies of the comparison is how an order comes to be accepted at a
 * price the pricing screen refuses.
 *
 * ── THE SELLER'S TERMS BOUND THE RESELLER'S ──────────────────────────
 * The seller sets a retail RANGE per store variant (RS-3,
 * `minRetailInr` / `maxRetailInr`). No associate can break it, so a
 * price outside it is refused AT THE MOMENT THE RESELLER SETS IT rather
 * than weeks later at the order — the person who can fix it is looking
 * at the screen now, and an order refused at create is refused with a
 * customer already on the phone.
 *
 * A range END that is absent is NOT a bound: the seller left that side
 * open, and treating a missing maximum as zero would refuse every price.
 */

import { toPaise } from '../../reseller-catalogue/services/reseller-price-rules';

export interface AssociatePriceRange {
  /** Decimal strings, or null where the seller left that side open. */
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
}

export interface AssociatePriceRefusal {
  readonly code:
    | 'INVALID_AMOUNT'
    | 'ASSOCIATE_PRICE_MUST_BE_POSITIVE'
    | 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE';
  readonly message: string;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/**
 * The rule the retail price breaks, or null when it is allowed.
 *
 * `retailInr` is the figure as typed; the range is the seller's, as
 * stored on the store variant (or the seller's default row — the
 * effective one, resolved per ROW by RS-3 and read here already decided).
 */
export function checkAssociatePrice(input: {
  readonly retailInr: string;
  readonly range: AssociatePriceRange;
}): AssociatePriceRefusal | null {
  const retail = toPaise(input.retailInr);
  if (retail === null) {
    return {
      code: 'INVALID_AMOUNT',
      message:
        'The selling price must be a rupee amount of zero or more, with at most two decimals.',
    };
  }
  if (retail <= 0) {
    return {
      code: 'ASSOCIATE_PRICE_MUST_BE_POSITIVE',
      message: 'Set a selling price above ₹0 — it is what this person’s customer pays per unit.',
    };
  }
  const min = input.range.minRetailInr === null ? null : toPaise(input.range.minRetailInr);
  const max = input.range.maxRetailInr === null ? null : toPaise(input.range.maxRetailInr);
  if (min !== null && retail < min) {
    return {
      code: 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE',
      message: `${rupees(retail)} is below the lowest price your seller allows for this product (${rupees(min)}).`,
    };
  }
  if (max !== null && retail > max) {
    return {
      code: 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE',
      message: `${rupees(retail)} is above the highest price your seller allows for this product (${rupees(max)}).`,
    };
  }
  return null;
}

/**
 * Does a price ALREADY STORED still sit inside the seller's range?
 *
 * The same comparison, asked of history rather than of a new write, and
 * the reason it is a separate question: a seller may move a range under
 * an existing price, which leaves that price out of range through nobody
 * doing anything. It is REPORTED — on the associate list and on the
 * pricing screen — and deliberately NOT auto-adjusted: a price somebody
 * negotiated with their own customer is not ours to change, and silently
 * nudging it to the new boundary would alter what a customer is charged
 * without the reseller ever being told. The order is refused at create
 * if nobody has acted by then, which is late — hence the report.
 */
export function isWithinRange(input: {
  readonly retailInr: string;
  readonly range: AssociatePriceRange;
}): boolean {
  return checkAssociatePrice(input)?.code !== 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE';
}
