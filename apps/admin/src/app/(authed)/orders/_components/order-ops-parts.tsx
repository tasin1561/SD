'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@skydrop/ui/app/button';
import './order-ops.css';

/**
 * Display-only pieces shared by the order-operations area of the staff
 * console: /orders, the order detail panels, the call centre and the
 * operator queues (failed deliveries, re-attempts, manual placement,
 * courier decisions, holds, NSA). Nothing here fetches, decides or
 * formats a figure — every value arrives as a ready node, so a money
 * string is still the caller's own `<Money>`.
 */

/** A section: a plain-text heading over ONE soft card. */
export function OoSection({
  title,
  note,
  action,
  id,
  flush = false,
  tone,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly id?: string | undefined;
  /** No padding inside the card — for a table or a panel with its own. */
  readonly flush?: boolean;
  /** `critical` draws the red rule god mode and other irreversible panels carry. */
  readonly tone?: 'critical' | 'warn' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="oo-section">
      <SectionHeading title={title} note={note} action={action} />
      <div className="oo-card" data-flush={flush ? '1' : undefined} data-tone={tone}>
        {children}
      </div>
    </section>
  );
}

/** A soft card with no heading of its own. */
export function OoCard({
  flush = false,
  tone,
  className,
  children,
}: {
  readonly flush?: boolean;
  readonly tone?: 'critical' | 'warn' | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      className={className === undefined ? 'oo-card' : `oo-card ${className}`}
      data-flush={flush ? '1' : undefined}
      data-tone={tone}
    >
      {children}
    </div>
  );
}

export type FactTone = 'accent' | 'good' | 'warn' | 'bad';

/** A standing fact under a page title — never an action. */
export function MetaFact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: FactTone | undefined;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="oo-fact" data-tone={tone}>
      {dot && <span className="oo-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/** A Next link drawn as the app button. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  target,
  className,
  children,
}: {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly target?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} target={target} className={buttonClassName(variant, size, false, className)}>
      <span className="sk-btn__fx" aria-hidden />
      {icon !== undefined && (
        <span className="sk-btn__icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="sk-btn__label">{children}</span>
    </Link>
  );
}

/** A label / value list. Values are ready nodes; nothing is formatted here. */
export function Facts({
  items,
  columns = 1,
}: {
  readonly items: ReadonlyArray<{
    readonly label: ReactNode;
    readonly value: ReactNode;
    readonly total?: boolean;
  }>;
  readonly columns?: 1 | 2;
}): ReactElement {
  return (
    <dl className="oo-facts" data-cols={columns === 2 ? '2' : undefined}>
      {items.map((it, i) => (
        <FactPair key={i} label={it.label} value={it.value} total={it.total === true} />
      ))}
    </dl>
  );
}

function FactPair({
  label,
  value,
  total,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly total: boolean;
}): ReactElement {
  return (
    <>
      <dt className={total ? 'oo-facts__total' : undefined}>{label}</dt>
      <dd className={total ? 'oo-facts__total' : undefined}>{value}</dd>
    </>
  );
}

export type NoticeTone = 'info' | 'warn' | 'bad' | 'good' | 'neutral';

/** A tinted note with an icon — colour is never the only signal. */
export function Notice({
  tone = 'neutral',
  icon,
  title,
  role,
  children,
}: {
  readonly tone?: NoticeTone;
  readonly icon?: ReactNode;
  readonly title?: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="oo-notice" data-tone={tone} role={role}>
      {icon !== undefined && (
        <span className="oo-notice__icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="oo-notice__body">
        {title !== undefined && <p className="oo-notice__title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** A back link above a page header. */
export function BackLink({
  href,
  icon,
  children,
}: {
  readonly href: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className="oo-back">
      {icon}
      {children}
    </Link>
  );
}

export type AgeTone = 'fresh' | 'aging' | 'late' | 'neutral';

/**
 * How long something has waited, as a small chip: a clock icon + the
 * caller's own words ("3h", "2 days"). The tone is the caller's existing
 * judgement (its own `waitTone`), never recomputed here, and the word is
 * always there so colour is never the only signal.
 */
export function AgeChip({
  tone = 'neutral',
  title,
  children,
}: {
  readonly tone?: AgeTone;
  readonly title?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="oo-age sk-figure" data-tone={tone} title={title}>
      <Clock size={12} strokeWidth={2.2} aria-hidden />
      {children}
    </span>
  );
}
