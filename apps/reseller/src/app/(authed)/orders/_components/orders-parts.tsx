'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@skydrop/ui/app/button';
import './orders.css';

/**
 * Display-only pieces shared by the store's orders area (list, place an
 * order, detail, CSV import, the call-cap queue). Nothing here fetches,
 * decides or formats a figure: every value arrives as a ready node, so
 * each screen still computes exactly what it computed before.
 */

/** A section: a plain-text heading over ONE bordered card. */
export function RoSection({
  title,
  note,
  action,
  id,
  flush = false,
  bare = false,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly id?: string | undefined;
  /** No padding inside the card — for a table or a panel with its own. */
  readonly flush?: boolean;
  /** No card at all — for content that draws its own (a state, a table). */
  readonly bare?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="ro-section">
      <SectionHeading title={title} note={note} action={action} />
      {bare ? (
        children
      ) : (
        <div className="ro-card" data-flush={flush ? '1' : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A Next link drawn as the app button (same look as `ButtonLink`, client navigation). */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
}: {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className={buttonClassName(variant, size, false, className)}>
      <span className="sk-btn__fx" aria-hidden />
      {icon !== undefined && icon !== null ? (
        <span className="sk-btn__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="sk-btn__label">{children}</span>
    </Link>
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
    <Link href={href} className="ro-back">
      {icon}
      {children}
    </Link>
  );
}

/** A label / value list. Values are ready nodes; nothing is formatted here. */
export function Facts({
  items,
  alignEnd = false,
}: {
  readonly items: ReadonlyArray<{
    readonly label: ReactNode;
    readonly value: ReactNode;
    readonly total?: boolean;
  }>;
  /** Values flush right — for a column of figures. */
  readonly alignEnd?: boolean;
}): ReactElement {
  return (
    <dl className="ro-facts" data-align={alignEnd ? 'end' : undefined}>
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
      <dt className={total ? 'ro-facts__total' : undefined}>{label}</dt>
      <dd className={total ? 'ro-facts__total' : undefined}>{value}</dd>
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
    <div className="ro-notice" data-tone={tone} role={role}>
      {icon !== undefined && icon !== null ? (
        <span className="ro-notice__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="ro-notice__body">
        {title !== undefined ? <p className="ro-notice__title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * The restating block a confirm step opens with — the entity, the amount
 * when money moves, and the consequence in one sentence — drawn with the
 * ConfirmDialog's own classes, for the two confirms whose confirm button
 * must stay disabled until a reason is typed (ConfirmDialog has no such
 * switch, and dropping the rule would change what can be sent).
 */
export function ConfirmSubject({
  entity,
  entityIsIdentifier = false,
  amount,
  consequence,
  children,
}: {
  readonly entity: string;
  readonly entityIsIdentifier?: boolean;
  readonly amount?: ReactNode;
  readonly consequence: ReactNode;
  /** The inputs the act needs (a reason), and any error, under the restatement. */
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="sk-confirm">
      <div className="sk-confirm__subject">
        <span className={entityIsIdentifier ? 'sk-confirm__entity sk-ident' : 'sk-confirm__entity'}>
          {entity}
        </span>
        {amount !== undefined && amount !== null ? (
          <span className="sk-confirm__amount sk-figure">{amount}</span>
        ) : null}
      </div>
      <p className="sk-confirm__consequence">{consequence}</p>
      {children}
    </div>
  );
}
