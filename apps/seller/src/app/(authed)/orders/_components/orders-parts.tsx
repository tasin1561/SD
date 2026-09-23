'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@skydrop/ui/app/button';
import './orders.css';

/**
 * Display-only pieces shared by the orders area (orders, pending, create,
 * edit, detail, imports) and tracking. Nothing here fetches, decides or
 * formats a figure: every value arrives as a ready node.
 */

/** A section: a plain-text heading over ONE bordered card. */
export function OrdSection({
  title,
  note,
  action,
  id,
  flush = false,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly id?: string | undefined;
  /** No padding inside the card — for a table or a panel with its own. */
  readonly flush?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="ord-section">
      <SectionHeading title={title} note={note} action={action} />
      <div className="ord-card" data-flush={flush ? '1' : undefined}>
        {children}
      </div>
    </section>
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
    <span className="ord-fact" data-tone={tone}>
      {dot && <span className="ord-fact__dot" aria-hidden />}
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
    <dl className="ord-facts" data-cols={columns === 2 ? '2' : undefined}>
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
      <dt className={total ? 'ord-facts__total' : undefined}>{label}</dt>
      <dd className={total ? 'ord-facts__total' : undefined}>{value}</dd>
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
    <div className="ord-notice" data-tone={tone} role={role}>
      {icon !== undefined && (
        <span className="ord-notice__icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="ord-notice__body">
        {title !== undefined && <p className="ord-notice__title">{title}</p>}
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
    <Link href={href} className="ord-back">
      {icon}
      {children}
    </Link>
  );
}
