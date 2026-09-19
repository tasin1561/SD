'use client';

import { clsx } from 'clsx';
import type { ComponentType, ReactElement, ReactNode } from 'react';

/**
 * CONSOLE CHROME — the motifs the PRECISION LOGISTICS comps lean on.
 *
 * These are ADDITIONS to `@skydrop/ui/components`, not a second set:
 * nothing here re-implements a Card, a Button, a Table or a Stat, and
 * everything reads the same tokens every other primitive reads. They
 * live in the shared package rather than in apps/seller for the reason
 * FE-6 gives — a colour or a shape defined at a call site is a colour
 * or a shape that drifts — and they are unreferenced by apps/admin, so
 * the admin bundle is unchanged.
 *
 * What each one is FOR, since a name alone will not say:
 *
 *   Crumbs       where this page sits. The comps put it above every
 *                title and it is the only thing that says a parcel
 *                belongs to an order belongs to a list.
 *   MetaChip     a standing fact about the page, under its title —
 *                "48 active", "100% verified". NEVER an action.
 *   SectionBand  the rule above a dense region: an ordinal, a name, and
 *                the controls that act on what is below it.
 *   FilterChip   a filter that carries its own count.
 *   StripFact    one fact in the bottom status strip.
 */

/* ═════════════════════════════════════════════════════════════════════
 * Crumbs
 * ═════════════════════════════════════════════════════════════════════ */

export type Crumb = {
  readonly label: string;
  /** Omit for the current page — the last crumb is never a link. */
  readonly href?: string;
};

/**
 * `LinkLike` is re-declared rather than imported from `app-shell` so
 * this module has no reason to pull the shell in; the shape is the
 * caller's `next/link`, and the package still takes no Next dependency.
 */
export type CrumbLink = ComponentType<{
  href: string;
  className: string;
  children: ReactNode;
}>;

export function Crumbs({
  items,
  Link,
  className,
}: {
  readonly items: readonly Crumb[];
  readonly Link: CrumbLink;
  readonly className?: string;
}): ReactElement {
  return (
    // A real <nav> with a real label: a breadcrumb is a navigation
    // landmark, and "Breadcrumb" is what a screen reader user is
    // listening for when they ask where they are.
    <nav aria-label="Breadcrumb" className={clsx('min-w-0', className)}>
      <ol className="text-text-faint flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] tracking-[0.08em] uppercase">
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="opacity-50">
                  /
                </span>
              )}
              {crumb.href === undefined || last ? (
                <span
                  className={clsx('truncate', last && 'text-accent')}
                  // The current page, announced as such rather than
                  // being the one item that merely looks different.
                  {...(last ? { 'aria-current': 'page' as const } : {})}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="hover:text-text-body truncate transition-colors">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ═════════════════════════════════════════════════════════════════════
 * MetaChip
 * ═════════════════════════════════════════════════════════════════════ */

export type MetaTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const META_TONE: Record<MetaTone, string> = {
  neutral: 'bg-surface-raised text-text-muted border-border',
  accent: 'bg-accent-tint text-accent border-[var(--color-accent-ring)]',
  good: 'bg-[var(--status-delivered-bg)] text-[var(--status-delivered-fg)] border-[var(--status-delivered-ring)]',
  warn: 'bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] border-[var(--status-pending-ring)]',
  bad: 'bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)] border-[var(--status-failed-ring)]',
};

export function MetaChip({
  children,
  tone = 'neutral',
  icon,
  dot = false,
}: {
  readonly children: ReactNode;
  readonly tone?: MetaTone;
  readonly icon?: ReactNode;
  /**
   * A filled dot before the text.
   *
   * It is a SECOND channel for the tone, not a decoration: the tones
   * differ by hue, and hue alone is what a colour-blind reader does not
   * get. The dot does not fix that on its own either, which is why the
   * text of one of these always says what it means.
   */
  readonly dot?: boolean;
}): ReactElement {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-[0.06em] uppercase',
        META_TONE[tone],
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {icon !== undefined && (
        <span aria-hidden className="shrink-0">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

/* ═════════════════════════════════════════════════════════════════════
 * SectionBand
 * ═════════════════════════════════════════════════════════════════════ */

export function SectionBand({
  index,
  title,
  note,
  action,
  className,
}: {
  /** "01", "02" — the reading order of the page's regions. */
  readonly index?: string;
  readonly title: ReactNode;
  /** A quiet line to the right of the title: a timestamp, a mode. */
  readonly note?: ReactNode;
  /** Controls that act on what is BELOW the band. */
  readonly action?: ReactNode;
  readonly className?: string;
}): ReactElement {
  return (
    <div
      className={clsx(
        'border-border bg-[var(--console-band-bg)] flex flex-wrap items-center gap-x-3 gap-y-2 rounded-t-[var(--radius-3)] border border-b-0 px-3 py-2.5',
        className,
      )}
    >
      <h2 className="text-text-strong flex min-w-0 items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.1em] uppercase">
        <span aria-hidden className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" />
        {index !== undefined && (
          <span aria-hidden className="text-accent">
            {index} //
          </span>
        )}
        <span className="truncate">{title}</span>
      </h2>
      {note !== undefined && <div className="text-text-faint min-w-0 text-xs">{note}</div>}
      {action !== undefined && (
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{action}</div>
      )}
    </div>
  );
}

/**
 * The body a band sits on top of.
 *
 * A band is `rounded-t` with no bottom border, so whatever follows has
 * to close the box. Rather than leave that to each call site to
 * remember — and have one of them forget, leaving a band floating over
 * a gap — this is the matching half.
 */
export function BandBody({
  children,
  className,
  flush = false,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  /** No padding — for a table, which brings its own. */
  readonly flush?: boolean;
}): ReactElement {
  return (
    <div
      className={clsx(
        'border-border bg-surface overflow-hidden rounded-b-[var(--radius-3)] border',
        !flush && 'px-3 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
 * FilterChip
 * ═════════════════════════════════════════════════════════════════════ */

export function FilterChip({
  label,
  count,
  active,
  dotColor,
  onClick,
}: {
  readonly label: ReactNode;
  readonly count?: number | undefined;
  readonly active: boolean;
  /** A CSS colour for the leading dot — a status kind's own hue. */
  readonly dotColor?: string | undefined;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      // `aria-pressed`, not a class: "this filter is on" has to reach a
      // screen reader, and the fill alone does not carry it.
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-2)] border px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-accent-fill text-accent-fg border-transparent font-medium'
          : 'border-border text-text-muted hover:text-text-body hover:border-border-strong',
      )}
    >
      {dotColor !== undefined && !active && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
      )}
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span
          className={clsx(
            'shrink-0 rounded-[3px] px-1 font-mono text-[11px] tabular-nums',
            active ? 'bg-black/20' : 'bg-surface-raised text-text-faint',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ═════════════════════════════════════════════════════════════════════
 * StripFact
 * ═════════════════════════════════════════════════════════════════════ */

export function StripFact({
  label,
  value,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: 'neutral' | 'good' | 'warn';
}): ReactElement {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className={clsx(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          tone === 'good' && 'bg-[var(--status-delivered-fg)]',
          tone === 'warn' && 'bg-[var(--status-pending-fg)]',
          tone === 'neutral' && 'bg-[var(--color-text-faint)]',
        )}
      />
      <span className="tracking-[0.06em] uppercase">{label}:</span>
      <span className="text-text-body min-w-0 truncate">{value}</span>
    </span>
  );
}
