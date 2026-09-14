/**
 * RS-3 — the rules a reseller price row must satisfy. Pure, and in whole
 * PAISE: amounts arrive as decimal strings of at most two places, and
 * comparing them as integers is exact where comparing floats is not.
 *
 * A row is four figures — transfer price (what the store pays the
 * seller), and the retail minimum, maximum and suggestion. The rules:
 *   - every figure is ≥ 0 with at most two decimals;
 *   - the transfer price is present and > 0 (a variant a store can sell
 *     for nothing is a gift, not a price);
 *   - min ≤ max, and a suggestion sits inside [min, max], comparing only
 *     the figures that are set.
 * The same rules hold for the seller's default row and for a store's
 * override row — each is judged whole, on its own (an override is never
 * a per-field patch over the default). The migration's CHECKs are the
 * backstop; this is where the words for a person come from.
 */

export interface PriceInput {
  readonly transferPriceInr: string | null | undefined;
  readonly minRetailInr?: string | null | undefined;
  readonly maxRetailInr?: string | null | undefined;
  readonly suggestedRetailInr?: string | null | undefined;
}

export interface PriceRuleRefusal {
  readonly code:
    | 'INVALID_AMOUNT'
    | 'TRANSFER_PRICE_REQUIRED'
    | 'RETAIL_RANGE_INVERTED'
    | 'SUGGESTED_OUTSIDE_RANGE';
  readonly message: string;
}

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

/** '123.4' → 12340. null for anything that is not a plain non-negative amount. */
export function toPaise(value: string): number | null {
  const v = value.trim();
  if (!AMOUNT.test(v)) return null;
  const [rupees = '0', paise = ''] = v.split('.');
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
}

function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

function rupees(p: number): string {
  return `₹${(p / 100).toFixed(2)}`;
}

/** The first rule a row breaks, or null when it is a valid price row. */
export function checkPrice(input: PriceInput): PriceRuleRefusal | null {
  const figures: Array<[label: string, raw: string | null | undefined]> = [
    ['transfer price', input.transferPriceInr],
    ['minimum retail price', input.minRetailInr],
    ['maximum retail price', input.maxRetailInr],
    ['suggested retail price', input.suggestedRetailInr],
  ];
  const paise: Array<number | null> = [];
  for (const [label, raw] of figures) {
    if (blank(raw)) {
      paise.push(null);
      continue;
    }
    const p = toPaise(raw ?? '');
    if (p === null) {
      return {
        code: 'INVALID_AMOUNT',
        message: `The ${label} must be a rupee amount of zero or more, with at most two decimals.`,
      };
    }
    paise.push(p);
  }
  const [transfer, min, max, suggested] = paise;
  if (transfer === null || transfer === undefined || transfer <= 0) {
    return {
      code: 'TRANSFER_PRICE_REQUIRED',
      message: 'Set a transfer price above ₹0 — it is what the store pays you for each unit.',
    };
  }
  if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
    return {
      code: 'RETAIL_RANGE_INVERTED',
      message: `The minimum retail price (${rupees(min)}) is above the maximum (${rupees(max)}).`,
    };
  }
  if (suggested !== null && suggested !== undefined) {
    if (min !== null && min !== undefined && suggested < min) {
      return {
        code: 'SUGGESTED_OUTSIDE_RANGE',
        message: `The suggested retail price (${rupees(suggested)}) is below the minimum (${rupees(min)}).`,
      };
    }
    if (max !== null && max !== undefined && suggested > max) {
      return {
        code: 'SUGGESTED_OUTSIDE_RANGE',
        message: `The suggested retail price (${rupees(suggested)}) is above the maximum (${rupees(max)}).`,
      };
    }
  }
  return null;
}

/** A blank-or-amount string normalised for storage: null, or the trimmed amount. */
export function normaliseAmount(v: string | null | undefined): string | null {
  return blank(v) ? null : (v ?? '').trim();
}
