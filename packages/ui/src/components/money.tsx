import type { ReactElement } from 'react';
import clsx from 'clsx';

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
function formatInr(value: string | number, opts: { decimals: boolean }): string {
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
  decimals = true,
  size = 'sm',
  className,
}: MoneyProps): ReactElement {
  const n = typeof amount === 'number' ? amount : Number(amount);
  const negative = Number.isFinite(n) && n < 0;
  // An explicit direction wins; otherwise a negative number is a debit.
  const effective: MoneyDirection =
    direction !== 'neutral' ? direction : negative ? 'debit' : 'neutral';

  const sign =
    effective === 'credit' ? '+' : effective === 'debit' || negative ? '−' : '';

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
      } ${formatInr(amount, { decimals })} ${currency}`.trim()}
    >
      {sign}
      {SYMBOL[currency]}
      {formatInr(amount, { decimals })}
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
