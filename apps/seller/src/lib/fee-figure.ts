import type { SellerFeeView } from './api-hooks';

/**
 * A fee, in words, for a seller about to spend it.
 *
 * ONE function, read by both return dialogs, because the two were the
 * reason this exists: one carried the literal `₹200` in its copy and the
 * other named no figure at all, and they charge DIFFERENT fees. Two
 * places formatting the same thing is how they came to disagree.
 *
 * Three shapes, and the difference between them is load-bearing:
 *
 *   priced, in rupees   → "₹200.00"
 *   priced, agreed in   → "₹162.60" plus "agreed as ৳200.00"
 *     another currency     — the second half is what makes the first
 *                            checkable, and the rate moves, so a seller
 *                            who only ever saw the taka figure would be
 *                            surprised by the debit.
 *   unpriceable         → the AGREED figure alone, never a rupee one.
 *
 * `null` means we have nothing to say yet (still loading, or the fee is
 * not in the response). The caller falls back to prose — "a return fee
 * applies" — rather than printing a dash, because a dash reads as zero.
 *
 * NEVER returns a rupee figure when `amountInr` is null. PRC-8 refuses
 * to CHARGE an unpriceable fee rather than billing zero; showing a zero
 * here would promise a free return and then take money for it.
 */
export interface FeeFigure {
  /** What to show as THE number. */
  readonly primary: string;
  /** The agreed amount, when it is not the same thing. Null otherwise. */
  readonly agreed: string | null;
  /** False when we could not turn it into rupees. */
  readonly priced: boolean;
}

const SYMBOL: Readonly<Record<string, string>> = { INR: '₹', BDT: '৳' };

function money(amount: string, currency: string | null): string {
  const symbol = currency === null ? '' : (SYMBOL[currency] ?? `${currency} `);
  return `${symbol}${amount}`;
}

export function feeFigure(fee: SellerFeeView | undefined): FeeFigure | null {
  if (fee === undefined) return null;
  const agreedInRupees = fee.agreedCurrency === 'INR' || fee.agreedCurrency === null;
  if (fee.amountInr === null) {
    // Unpriceable. The agreed figure is the only true thing we have.
    return { primary: money(fee.agreedAmount, fee.agreedCurrency), agreed: null, priced: false };
  }
  return {
    primary: money(fee.amountInr, 'INR'),
    agreed: agreedInRupees ? null : money(fee.agreedAmount, fee.agreedCurrency),
    priced: true,
  };
}

/** Pick one kind out of the endpoint's list. */
export function feeOfKind(
  items: readonly SellerFeeView[] | undefined,
  kind: SellerFeeView['kind'],
): FeeFigure | null {
  return feeFigure(items?.find((f) => f.kind === kind));
}
