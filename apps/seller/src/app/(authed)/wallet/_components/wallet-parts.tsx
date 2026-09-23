import type { ReactElement, ReactNode } from 'react';
import './wallet.css';

/**
 * The wallet's presentational pieces. Nothing here fetches, decides a
 * permission or computes a figure — every value arrives as a prop, and
 * every amount arrives as the caller's own `<Money>` node.
 */

export type WalTone = 'good' | 'bad' | 'warn' | 'accent' | undefined;

/** A standing fact under the page title — never an action. */
export function WalFact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: WalTone;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="wal-fact" data-tone={tone}>
      {dot && <span className="wal-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * A boxed notice: an icon chip, an optional bold line and the body. The
 * tone is never the only signal — the icon and the words carry it too.
 */
export function WalCallout({
  tone,
  icon,
  title,
  children,
  role,
}: {
  readonly tone?: 'critical' | 'warn' | 'info' | undefined;
  readonly icon: ReactNode;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
}): ReactElement {
  return (
    <div className="wal-callout" data-tone={tone} role={role}>
      <span className="wal-callout__icon" aria-hidden>
        {icon}
      </span>
      <div className="wal-callout__body">
        {title !== undefined && <div className="wal-callout__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** One label/value pair in a page's bottom strip. */
export function WalStripFact({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: 'good' | 'warn' | undefined;
}): ReactElement {
  return (
    <span className="wal-strip__fact">
      <span className="wal-strip__label">{label}</span>
      <span className="wal-strip__value sk-figure" data-tone={tone}>
        {value}
      </span>
    </span>
  );
}
