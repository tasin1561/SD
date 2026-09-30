import { Currency } from '@skydrop/db';
import type { Prisma } from '@skydrop/db';

/**
 * Money in a sentence a person reads — grouped, to the paisa, with its
 * own symbol.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────
 * The FREIGHT_RECORDED line on a seller's consignment timeline read
 *
 *     Freight billed — ₹5688.89 (7680.00 BDT as agreed)
 *
 * — an ungrouped rupee figure, and a taka figure printed with an ISO
 * code trailing it instead of its symbol. Every other money figure a
 * seller sees goes through `Money` in `@skydrop/ui` (FE-6), which is
 * tabular and en-IN grouped and encodes direction as a sign; the rule
 * there is explicit that money never renders through a hand-rolled
 * `toFixed`. A STORED string cannot call a React component, which is
 * how this one escaped the rule and became the only ungrouped rupee
 * figure a seller was shown.
 *
 * ── WHY THIS IS SHARED AND NOT A THIRD PRIVATE COPY ──────────────────
 * `staff-wallet-transfer.service.ts` had already worked out the right
 * answer for the notes IT stores, as a module-private `rupees()`. A
 * second private copy for freight is how the two come to disagree about
 * the minus sign or the grouping, and a seller reading one figure on
 * their wallet and a differently-shaped one on their timeline has no
 * way to know both came from us. So the implementation lives here once
 * and that module re-exports it — the same argument WAL-1 makes about
 * `CREDIT_DIRECTIONS`, and BIN-1/CNS-2 about a policy with one reader.
 *
 * ── GROUPING IS en-IN FOR BOTH CURRENCIES, ON PURPOSE ────────────────
 * Bangladesh uses the same lakh/crore grouping as India (2,2,3), so
 * ৳12,34,567.00 is correct there and not an Indian figure wearing a
 * taka symbol. One formatter, both currencies, no per-currency locale
 * table to drift.
 *
 * ── APPEND-ONLY ──────────────────────────────────────────────────────
 * `consignment_events` is append-only (CNS-6), so this reaches FUTURE
 * events only. Rows already written keep the figures they were written
 * with.
 */

const GROUPED = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * The symbol each currency is written with.
 *
 * `satisfies Record<Currency, string>` rather than a lookup with a
 * fallback: a third currency must fail to COMPILE until somebody
 * decides how it is written, instead of silently printing its ISO code
 * — which is exactly the shape of the bug this file fixes.
 */
const SYMBOL = {
  [Currency.INR]: '₹',
  [Currency.BDT]: '৳',
} satisfies Record<Currency, string>;

/** `₹1,234.50`, `৳7,680.00`, or `−₹388.60` for a negative figure. */
export function money(value: Prisma.Decimal, currency: Currency): string {
  // The minus is U+2212 MINUS SIGN, not a hyphen: it aligns with the
  // digits in the tabular figures these sentences sit beside.
  const shown = `${SYMBOL[currency]}${GROUPED.format(Number(value.abs().toFixed(2)))}`;
  return value.lessThan(0) ? `−${shown}` : shown;
}

/** `₹1,234.50`, or `−₹388.60` for a negative figure. */
export function rupees(value: Prisma.Decimal): string {
  return money(value, Currency.INR);
}
