/**
 * A fee's currency is a CHOICE, not free text.
 *
 * `pricing.flat_delivery_fee` and its siblings are read in the currency
 * their `_currency` partner names, and the API refuses a value that is
 * not one of these (`BAD_FEE_CURRENCY`) rather than guessing. Left as a
 * text box, "TAKA" or "bdt " saves cleanly and then surfaces much later
 * as an order that could not be priced — so the picker exists to make
 * the mistake unavailable rather than merely detected.
 *
 * FE-2 still holds: this is convenience, not enforcement. The server
 * validates regardless of what the UI offered.
 */
export const FEE_CURRENCY_OPTIONS = ['INR', 'BDT'] as const;

/** Whether a settings key names the currency a fee is agreed in. */
export function isFeeCurrencyKey(key: string): boolean {
  return key.startsWith('pricing.') && key.endsWith('_fee_currency');
}
