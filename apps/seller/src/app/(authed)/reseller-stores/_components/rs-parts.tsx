import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, OctagonX } from 'lucide-react';
import type { AsyncPhase } from '@skydrop/ui/app/async-button';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import './reseller-stores.css';

/**
 * The reseller stores area's presentational pieces. Nothing here fetches,
 * decides a permission or computes a figure: every value arrives as a
 * prop, and every amount arrives as the caller's own `<Money>` / `<Num>`
 * node.
 */

/** A section: a plain-text heading over ONE bordered card. */
export function RsSection({
  title,
  note,
  action,
  flush = false,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  /** No padding inside the card — for a table or a panel with its own. */
  readonly flush?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="rs-section">
      <SectionHeading title={title} note={note} action={action} />
      <div className="rs-card" data-flush={flush ? '1' : undefined}>
        {children}
      </div>
    </section>
  );
}

export type RsTone = 'good' | 'warn' | 'bad' | 'accent' | undefined;

/** A standing fact under a page title — never an action. */
export function RsFact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: RsTone;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="rs-fact" data-tone={tone}>
      {dot && <span className="rs-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/** The row of facts under a page title. */
export function RsFacts({ children }: { readonly children: ReactNode }): ReactElement {
  return <span className="rs-facts">{children}</span>;
}

/** A back link above a page header. */
export function RsBack({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className="rs-back">
      <ArrowLeft size={13} aria-hidden />
      {children}
    </Link>
  );
}

/** A "go to" link with an arrow that steps right on hover. */
export function RsLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className="rs-link">
      {children}
      <ArrowRight size={13} aria-hidden className="rs-link__arrow" />
    </Link>
  );
}

/** A server verdict, verbatim (FE-2), with an icon so colour is not the only signal. */
export function RsError({
  children,
  compact = false,
}: {
  readonly children: ReactNode;
  readonly compact?: boolean;
}): ReactElement {
  return (
    <p role="alert" className="rs-error" data-compact={compact ? '1' : undefined}>
      <OctagonX size={compact ? 13 : 15} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** A boxed notice: an icon chip and the body. The icon and the words carry the tone too. */
export function RsCallout({
  tone,
  icon,
  title,
  role,
  children,
}: {
  readonly tone?: 'critical' | 'warn' | 'info' | undefined;
  readonly icon: ReactNode;
  readonly title?: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="rs-callout" data-tone={tone} role={role}>
      <span className="rs-callout__icon" aria-hidden>
        {icon}
      </span>
      <div className="rs-callout__body">
        {title !== undefined && <div className="rs-callout__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** The bottom strip of a page. */
export function RsStrip({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="rs-strip">{children}</div>;
}

/** One label/value pair in a page's bottom strip. */
export function RsStripFact({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: 'good' | 'warn' | 'neutral' | undefined;
}): ReactElement {
  return (
    <span className="rs-strip__fact">
      <span className="rs-strip__label">{label}</span>
      <span className="rs-strip__value sk-figure" data-tone={tone}>
        {value}
      </span>
    </span>
  );
}

/** A product: its picture beside its name and its SKU (the identifier face). */
export function RsProduct({
  thumb,
  name,
  sku,
  extra,
}: {
  readonly thumb: ReactNode;
  readonly name: ReactNode;
  readonly sku: ReactNode;
  readonly extra?: ReactNode;
}): ReactElement {
  return (
    <div className="rs-product">
      {thumb}
      <div className="rs-product__text">
        <div className="rs-product__name">{name}</div>
        <div className="rs-product__sku">
          <span className="sk-ident">{sku}</span>
          {extra}
        </div>
      </div>
    </div>
  );
}

/**
 * The phase for an AsyncButton whose request a mutation owns: busy exactly
 * while it runs, otherwise left to the button (idle).
 */
export function pendingPhase(pending: boolean): AsyncPhase | undefined {
  return pending ? 'busy' : undefined;
}
