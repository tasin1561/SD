'use client';

import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@skydrop/ui/app/button';
import './as.css';

/**
 * Display-only pieces shared by this app's screens. Nothing here
 * fetches, decides or formats a figure: every value arrives as a ready
 * node, so each screen still computes exactly what it computes.
 */

/** A section: a plain-text heading over ONE bordered card. */
export function Section({
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
    <section id={id} className="as-section">
      <SectionHeading title={title} note={note} action={action} />
      {bare ? (
        children
      ) : (
        <div className="as-card" data-flush={flush ? '1' : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A Next link drawn as the app button — same look, client navigation. */
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
    <Link href={href} className="as-back">
      {icon}
      {children}
    </Link>
  );
}

/** A label / value list. Values are ready nodes; nothing is formatted here. */
export function Facts({
  items,
}: {
  readonly items: ReadonlyArray<{ readonly label: ReactNode; readonly value: ReactNode }>;
}): ReactElement {
  return (
    <dl className="as-facts">
      {items.map((it, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
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
    <div className="as-notice" data-tone={tone} role={role}>
      {icon !== undefined && icon !== null ? (
        <span className="as-notice__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="as-notice__body">
        {title !== undefined ? <p className="as-notice__title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
