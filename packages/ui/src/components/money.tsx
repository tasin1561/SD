'use client';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * What currency money should be SHOWN in, and at what rate.
 *
 * INR is canonical — every amount the system stores and every string
 * that reaches a component is rupees. A seller who works in taka should
 * not have to convert in their head, so this turns the whole app's
 * figures over at once rather than asking ~90 call sites to opt in.
 *
 * Deliberately a CONTEXT rather than a prop: a display preference is
 * ambient, and threading it through every table cell is how half of
 * them end up still showing rupees.
 *
 * No provider (admin, marketing, tests) means no conversion. Admin is
 * an operational console reading a canonical ledger; showing an operator
 * a converted figure would put them and the seller on different numbers
 * during the same phone call.
 */
export interface MoneyDisplay {
  readonly currency: 'INR' | 'BDT';
  /**
   * Rupees to `currency`. Null means we could not resolve one, and the
   * only honest response is to keep showing rupees — a wrong rate is
   * worse than the wrong currency.
   */
  readonly rate: string | null;
}

const MoneyDisplayContext = createContext<MoneyDisplay>({ currency: 'INR', rate: null });

export function MoneyDisplayProvider({
  value,
  children,
}: {
  readonly value: MoneyDisplay;
  readonly children: ReactNode;
}): ReactElement {
  return <MoneyDisplayContext.Provider value={value}>{children}</MoneyDisplayContext.Provider>;
}

export function useMoneyDisplay(): MoneyDisplay {
  return useContext(MoneyDisplayContext);
}

export type MoneyDirection = 'credit' | 'debit' | 'neutral';

/**
 * Format a decimal string as INR with grouping, without going through
 * Intl on every render for the common case.
 *
 * Indian digit grouping is NOT the western thousands pattern —
 * ₹12,34,567 not ₹1,234,567 — so `en-IN` is load-bearing here. Getting
 * it wrong is the kind of detail that quietly signals "built by someone
 * who does not operate in this market".
 */
function formatAmount(value: string | number, opts: { decimals: boolean }): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
}

export interface MoneyProps {
  /** Decimal string (preferred — no float rounding) or number. */
  readonly amount: string | number;
  /**
   * Ledger direction. `credit`/`debit` add BOTH a sign glyph and a
   * colour — colour alone is invisible to a colour-blind reader, and
   * "did money come in or go out" is not a detail to encode in hue.
   */
  readonly direction?: MoneyDirection;
  /** Currency label. INR is canonical; BDT appears in seller views. */
  readonly currency?: 'INR' | 'BDT';
  /**
   * Opt OUT of the display-currency conversion for one figure.
   *
   * For a number that has to agree with a rupee INPUT sitting beside it
   * — "available to withdraw" above a box you type rupees into. Showing
   * that figure in taka while the field expects rupees invites someone
   * to type the converted number, and the request is then refused or,
   * worse, quietly smaller than they meant.
   */
  readonly convert?: boolean;
  /** Hide the paise when a column is all round numbers. */
  readonly decimals?: boolean;
  /** Bigger, for a headline figure rather than a table cell. */
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
}

const SYMBOL: Record<'INR' | 'BDT', string> = { INR: '₹', BDT: '৳' };

/**
 * A money value.
 *
 * Always tabular-figured: in a column of amounts, proportional digits
 * are different widths, so values jitter horizontally as they change
 * and decimal points stop lining up — precisely the column a human
 * scans down looking for the odd one out.
 */
export function Money({
  amount,
  direction = 'neutral',
  currency = 'INR',
  convert: allowConvert = true,
  decimals = true,
  size = 'sm',
  className,
}: MoneyProps): ReactElement {
  const display = useMoneyDisplay();

  /**
   * Convert only when the caller handed us the canonical currency and
   * the display asks for a different one at a rate we actually have.
   *
   * A component that explicitly says `currency="BDT"` is stating a fact
   * about that figure (the taka we wired), not asking to be converted —
   * converting it again would multiply by the rate twice.
   */
  const convert =
    allowConvert && currency === 'INR' && display.currency !== 'INR' && display.rate !== null;
  const shownCurrency = convert ? display.currency : currency;
  const rawN = typeof amount === 'number' ? amount : Number(amount);
  const shown = convert && Number.isFinite(rawN) ? rawN * Number(display.rate) : amount;

  const n = typeof shown === 'number' ? shown : Number(shown);
  const negative = Number.isFinite(n) && n < 0;
  // An explicit direction wins; otherwise a negative number is a debit.
  const effective: MoneyDirection =
    direction !== 'neutral' ? direction : negative ? 'debit' : 'neutral';

  const sign = effective === 'credit' ? '+' : effective === 'debit' || negative ? '−' : '';

  return (
    <span
      className={clsx(
        'skydrop-tabular whitespace-nowrap',
        size === 'sm' && 'text-sm',
        size === 'md' && 'text-md',
        size === 'lg' && 'text-2xl font-semibold',
        effective === 'credit' && 'text-[var(--color-credit)]',
        effective === 'debit' && 'text-[var(--color-debit)]',
        effective === 'neutral' && 'text-text-strong',
        className,
      )}
      // Screen readers get words, not glyphs: "minus 1,200 rupees"
      // reads as a number, "debit ₹1,200" reads as a fact.
      aria-label={`${
        effective === 'credit' ? 'credit' : effective === 'debit' ? 'debit' : ''
      } ${formatAmount(shown, { decimals })} ${shownCurrency}`.trim()}
    >
      {sign}
      {SYMBOL[shownCurrency]}
      {formatAmount(shown, { decimals })}
    </span>
  );
}

/**
 * A non-money number that still lives in a column — quantities,
 * counts, weights, days. Same tabular treatment, no currency.
 */
export function Num({
  value,
  suffix,
  className,
}: {
  readonly value: string | number;
  readonly suffix?: string;
  readonly className?: string;
}): ReactElement {
  const n = typeof value === 'number' ? value : Number(value);
  const text = Number.isFinite(n) ? new Intl.NumberFormat('en-IN').format(n) : String(value);
  return (
    <span className={clsx('skydrop-tabular whitespace-nowrap', className)}>
      {text}
      {suffix !== undefined && <span className="text-text-muted ml-0.5">{suffix}</span>}
    </span>
  );
}

/**
 * An identifier that must be readable digit-by-digit and compared by
 * eye against a physical label — AWB, order number, serial.
 */
export function Ident({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}): ReactElement {
  return (
    <span
      className={clsx(
        'font-mono text-xs tracking-tight text-text-body whitespace-nowrap',
        className,
      )}
    >
      {value}
    </span>
  );
}
