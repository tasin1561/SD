'use client';

import Link from 'next/link';
import { OctagonX } from 'lucide-react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import type { AsyncPhase } from '@skydrop/ui/app/async-button';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@skydrop/ui/app/button';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import './stock-kit.css';

/**
 * The presentational pieces shared by the admin warehouse-records and
 * inventory screens (bins, consignments, manifests, pickups, adjustments,
 * cycle counts, movements, transfers, serial units).
 *
 * Nothing here fetches, decides a permission or computes a figure: every
 * value arrives as a prop from the page that owns the logic. Classes are
 * `stk-` prefixed and read brand tokens only.
 */

/** The page column: header, then sections, evenly spaced. */
export function AreaPage({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="stk-page">{children}</div>;
}

/** The app page header with Next's `Link` wired, usable from a server page. */
export function StockPageHeader(
  props: Omit<ComponentProps<typeof PageHeader>, 'Link'>,
): ReactElement {
  return <PageHeader {...props} Link={Link} />;
}

/** A section title (sentence case, no index) over its body. */
export function AreaSection({
  title,
  note,
  action,
  id,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly id?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="stk-section" aria-labelledby={id}>
      <SectionHeading title={title} note={note} action={action} id={id} />
      {children}
    </section>
  );
}

/**
 * A soft card surface. `title`/`subtitle`/`action` draw its head;
 * `flush` drops the body padding for a table inside it.
 */
export function Panel({
  title,
  subtitle,
  action,
  flush = false,
  tone,
  className,
  children,
}: {
  readonly title?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly action?: ReactNode;
  readonly flush?: boolean;
  readonly tone?: 'critical' | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  const hasHead = title !== undefined || subtitle !== undefined || action !== undefined;
  return (
    <div
      className={className ? `stk-card ${className}` : 'stk-card'}
      data-flush={flush ? '1' : undefined}
      data-tone={tone}
    >
      {hasHead && (
        <div className="stk-card__head">
          <div className="stk-card__titles">
            {title !== undefined && <h3 className="stk-card__title">{title}</h3>}
            {subtitle !== undefined && <div className="stk-card__sub">{subtitle}</div>}
          </div>
          {action !== undefined && <div className="stk-card__action">{action}</div>}
        </div>
      )}
      {children !== undefined && <div className="stk-card__body">{children}</div>}
    </div>
  );
}

/** A padded strip inside a flush panel (a state, a filter row, a footer). */
export function PanelPad({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="stk-pad">{children}</div>;
}

/** A vertical stack with even gaps. */
export function Stack({
  tight = false,
  children,
}: {
  readonly tight?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return <div className={tight ? 'stk-stack stk-stack--tight' : 'stk-stack'}>{children}</div>;
}

/** A standing fact under a page title — never an action. */
export function MetaFact({
  tone,
  children,
}: {
  readonly tone?: 'good' | 'accent' | 'warn' | 'bad' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="stk-fact" data-tone={tone}>
      {children}
    </span>
  );
}

export function MetaFacts({ children }: { readonly children: ReactNode }): ReactElement {
  return <span className="stk-facts">{children}</span>;
}

/** The app button's look on a Next link; navigation is never delayed. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className,
  'aria-label': ariaLabel,
}: {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly 'aria-label'?: string | undefined;
}): ReactElement {
  return (
    <Link
      href={href}
      className={buttonClassName(variant, size, false, className)}
      aria-label={ariaLabel}
    >
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

/** A group of actions, wrapping on a phone. */
export function Actions({
  children,
  end = false,
}: {
  readonly children: ReactNode;
  readonly end?: boolean;
}): ReactElement {
  return <div className={end ? 'stk-actions stk-actions--end' : 'stk-actions'}>{children}</div>;
}

/** A row of filters / controls above a list, wrapping on a phone. */
export function Toolbar({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="stk-toolbar">{children}</div>;
}

/** Label / value pairs — the replacement for the legacy DescriptionList. */
export function Facts({
  items,
  columns = 2,
}: {
  readonly items: ReadonlyArray<{ readonly label: string; readonly value: ReactNode }>;
  readonly columns?: 1 | 2 | 3 | 4;
}): ReactElement {
  return (
    <dl className="stk-dl" data-cols={columns}>
      {items.map((it) => (
        <div key={it.label} className="stk-dl__row">
          <dt className="stk-dl__label">{it.label}</dt>
          <dd className="stk-dl__value">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A grid of KPI cards. */
export function KpiGrid({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="stk-kpis">{children}</div>;
}

/** A form-field grid: one column on a phone, more above it. */
export function FieldGrid({
  columns = 2,
  children,
}: {
  readonly columns?: 1 | 2 | 3 | 4;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="stk-fields" data-cols={columns}>
      {children}
    </div>
  );
}

/**
 * A refusal from a WRITE or a failed read, shown verbatim (FE-2) — the
 * compact inline note that replaces the legacy `ErrorNote`.
 */
export function InlineError({
  message,
  retry,
}: {
  readonly message: string;
  readonly retry?: (() => void) | undefined;
}): ReactElement {
  return (
    <div className="stk-error" role="alert">
      <OctagonX size={16} aria-hidden className="stk-error__icon" />
      <p className="stk-error__text">{message}</p>
      {retry !== undefined && (
        <button type="button" onClick={retry} className="stk-error__retry">
          Retry
        </button>
      )}
    </div>
  );
}

/** A quiet explanatory line. */
export function Note({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone?: 'warn' | 'bad' | 'good' | 'faint' | undefined;
}): ReactElement {
  return (
    <p className="stk-note" data-tone={tone}>
      {children}
    </p>
  );
}

/** A tinted callout box. */
export function Callout({
  tone,
  icon,
  children,
}: {
  readonly tone?: 'warn' | 'info' | 'good' | 'bad' | undefined;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="stk-callout" data-tone={tone}>
      {icon !== undefined && (
        <span className="stk-callout__icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="stk-callout__body">{children}</div>
    </div>
  );
}

/** Inline text in a status tone (never the only signal — the words carry it). */
export function ToneText({
  tone,
  children,
}: {
  readonly tone: 'warn' | 'bad' | 'good' | 'faint' | 'muted';
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="stk-tone" data-tone={tone}>
      {children}
    </span>
  );
}

/** An identifier (bin code, SKU, consignment no, AWB, serial) in the mono face. */
export function Code({ children }: { readonly children: ReactNode }): ReactElement {
  return <span className="sk-ident">{children}</span>;
}

/** A quiet in-text link. */
export function TextLink({
  href,
  children,
  className,
  'aria-label': ariaLabel,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly 'aria-label'?: string | undefined;
}): ReactElement {
  return (
    <Link
      href={href}
      className={className ? `stk-link ${className}` : 'stk-link'}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

/** A dash for an absent value, faint. */
export function Dash(): ReactElement {
  return <span className="stk-faint">—</span>;
}

/**
 * The rolling-label phase of a TanStack mutation, for a controlled
 * `AsyncButton`. Busy while the request runs; success is announced by the
 * page's own toast, so it is not held here.
 */
export function mutationPhase(m: {
  readonly isPending: boolean;
  readonly isError?: boolean;
}): AsyncPhase {
  if (m.isPending) return 'busy';
  return 'idle';
}

/** The same, for a page that tracks its own busy flag. */
export function busyPhase(busy: boolean): AsyncPhase {
  return busy ? 'busy' : 'idle';
}
