'use client';

import Link from 'next/link';
import { OctagonX } from 'lucide-react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@skydrop/ui/app/button';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import type { AsyncPhase } from '@skydrop/ui/app/async-button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { statusLabel, stockUnitStatusKind } from '@skydrop/ui/status';
import type { StockUnitStatus } from '@skydrop/db';
import './stock-ui.css';

/**
 * The presentational pieces shared by the stock area of the seller
 * console — products, inventory, inbound consignments and held stock.
 *
 * Nothing here fetches, decides a permission or computes a figure. Every
 * value arrives as a prop from the page that owns the logic, exactly as
 * the dashboard's `dashboard-parts.tsx` does. Classes are `inv-`
 * prefixed and read brand tokens only.
 */

/** The page column: header, then sections, evenly spaced. */
export function AreaPage({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="inv-page">{children}</div>;
}

/**
 * The page header with Next's `Link` already wired, so a SERVER page can
 * render it without handing a component across the client boundary.
 */
export function StockPageHeader(
  props: Omit<ComponentProps<typeof PageHeader>, 'Link'>,
): ReactElement {
  return <PageHeader {...props} Link={Link} />;
}

/** A section title (plain sentence-case text, no index) over its body. */
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
    <section className="inv-section" aria-labelledby={id}>
      <SectionHeading title={title} note={note} action={action} id={id} />
      {children}
    </section>
  );
}

/** A soft card surface. `flush` drops the padding for a table inside it. */
export function Panel({
  flush = false,
  className,
  children,
}: {
  readonly flush?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      className={className ? `inv-card ${className}` : 'inv-card'}
      data-flush={flush ? '1' : undefined}
    >
      {children}
    </div>
  );
}

/** The padded strip inside a flush panel (a state, a filter row). */
export function PanelPad({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="inv-pad">{children}</div>;
}

/** A standing fact under a page title — never an action. */
export function MetaFact({
  tone,
  dot = false,
  icon,
  children,
}: {
  readonly tone?: 'good' | 'accent' | 'warn' | 'bad' | undefined;
  readonly dot?: boolean;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="inv-fact" data-tone={tone}>
      {dot && <span className="inv-fact__dot" aria-hidden />}
      {icon !== undefined && (
        <span className="inv-fact__icon" aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

export function MetaFacts({ children }: { readonly children: ReactNode }): ReactElement {
  return <span className="inv-facts">{children}</span>;
}

/**
 * The app button's look on a Next link. Navigation is never delayed;
 * `href` is passed through as written so a test reading the source sees
 * the literal destination.
 */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className,
}: {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <Link href={href} className={buttonClassName(variant, size, false, className)}>
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

/** A plain back link above a page ("← Back to catalogue"). */
export function BackLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className="inv-back">
      {children}
    </Link>
  );
}

/** A group of actions, wrapping on a phone. */
export function Actions({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="inv-actions">{children}</div>;
}

/** Label / value pairs — the replacement for the legacy DescriptionList. */
export function Facts({
  items,
  columns = 2,
}: {
  readonly items: ReadonlyArray<{ readonly label: string; readonly value: ReactNode }>;
  readonly columns?: 1 | 2 | 3;
}): ReactElement {
  return (
    <dl className="inv-dl" data-cols={columns}>
      {items.map((it) => (
        <div key={it.label} className="inv-dl__row">
          <dt className="inv-dl__label">{it.label}</dt>
          <dd className="inv-dl__value">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A grid of KPI cards. */
export function KpiGrid({ children }: { readonly children: ReactNode }): ReactElement {
  return <div className="inv-kpis">{children}</div>;
}

/** A form-field grid: one column on a phone, two above it. */
export function FieldGrid({
  columns = 2,
  children,
}: {
  readonly columns?: 1 | 2 | 3 | 4;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="inv-fields" data-cols={columns}>
      {children}
    </div>
  );
}

/**
 * A refusal from a WRITE, shown verbatim (FE-2) — the compact inline
 * note. A failed READ uses `ErrorState`, which carries a title and retry.
 */
export function InlineError({
  message,
  retry,
}: {
  readonly message: string;
  readonly retry?: (() => void) | undefined;
}): ReactElement {
  return (
    <div className="inv-error" role="alert">
      <OctagonX size={16} aria-hidden className="inv-error__icon" />
      <p className="inv-error__text">{message}</p>
      {retry !== undefined && (
        <button type="button" onClick={retry} className="inv-error__retry">
          Retry
        </button>
      )}
    </div>
  );
}

/** A quiet explanatory line. */
export function Note({ children }: { readonly children: ReactNode }): ReactElement {
  return <p className="inv-note">{children}</p>;
}

/** A dash for an absent value, faint. */
export function Dash(): ReactElement {
  return <span className="inv-faint">—</span>;
}

/**
 * The rolling-label phase of a TanStack mutation, for a controlled
 * `AsyncButton`. Busy while the request runs, the error while it stands;
 * success is announced by the page's own toast, so it is not held here.
 */
export function mutationPhase(m: {
  readonly isPending: boolean;
  readonly isError: boolean;
}): AsyncPhase {
  if (m.isPending) return 'busy';
  if (m.isError) return 'error';
  return 'idle';
}

/** The same, for a page that tracks its own busy flag. */
export function busyPhase(busy: boolean, failed = false): AsyncPhase {
  if (busy) return 'busy';
  if (failed) return 'error';
  return 'idle';
}

/**
 * The odometer's formatter for a count the legacy tile printed RAW
 * ("14820", not "14,820") — so a KPI card rolls the same string the old
 * tile showed rather than re-formatting it.
 */
export function rawCount(n: number): string {
  return String(n);
}

/**
 * A serial unit's status as a chip — the SAME kind mapper and word the
 * legacy `StockUnitStatusBadge` used (`stockUnitStatusKind` +
 * `statusLabel`), drawn with an icon. No local colour map.
 */
export function StockUnitStatusBadge({
  status,
}: {
  readonly status: StockUnitStatus;
}): ReactElement {
  return <StatusChip kind={stockUnitStatusKind(status)} label={statusLabel(status)} size="sm" />;
}
