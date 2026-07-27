import type { ReactElement, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * A skeleton row/block.
 *
 * Preferred over a spinner for anything past ~300ms: a skeleton
 * reserves the space the content will occupy, so the page does not
 * jump when data lands (CLS), and it communicates SHAPE — the reader
 * starts parsing the layout before the numbers arrive.
 */
export function Skeleton({
  className,
  rounded = 'sm',
}: {
  readonly className?: string;
  readonly rounded?: 'sm' | 'full';
}): ReactElement {
  return (
    <div
      aria-hidden
      className={clsx(
        'bg-surface-hover animate-pulse',
        rounded === 'full' ? 'rounded-full' : 'rounded-[var(--radius-1)]',
        className,
      )}
    />
  );
}

/** N skeleton table rows, sized to the real column count. */
export function SkeletonRows({
  rows = 5,
  cols = 4,
}: {
  readonly rows?: number;
  readonly cols?: number;
}): ReactElement {
  return (
    <div
      className="divide-border divide-y"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3 px-3 py-2.5">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className={clsx('h-3.5', c === 0 ? 'w-[22%]' : c === cols - 1 ? 'w-[12%]' : 'w-[16%]')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * An inline error with a way out.
 *
 * Per FE-2 the server's verdict is surfaced VERBATIM — `[CODE]
 * message` — because paraphrasing a guardrail's reason is how a UI
 * starts lying about why something was refused. `retry` exists so an
 * error is never a dead end either.
 */
export function ErrorNote({
  message,
  retry,
  className,
}: {
  readonly message: string;
  readonly retry?: () => void;
  readonly className?: string;
}): ReactElement {
  return (
    <div
      role="alert"
      className={clsx(
        'border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] flex items-start justify-between gap-3 rounded-[var(--radius-2)] border px-3 py-2',
        className,
      )}
    >
      <p className="text-[var(--color-critical)] text-xs leading-relaxed">{message}</p>
      {retry !== undefined && (
        <button
          type="button"
          onClick={retry}
          className="text-[var(--color-critical)] shrink-0 text-xs font-medium underline underline-offset-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * A headline metric.
 *
 * `tone` exists so a number that means trouble (outstanding float,
 * loss-making lanes) can look like trouble without a separate
 * component — but it is deliberately not colour-only: pair it with a
 * label that says what the number is.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly tone?: 'neutral' | 'warn' | 'bad' | 'good';
  readonly className?: string;
}): ReactElement {
  return (
    <div
      className={clsx(
        'border-border bg-surface rounded-[var(--radius-3)] border px-4 py-3',
        tone === 'warn' && 'border-[var(--status-pending-ring)]',
        tone === 'bad' && 'border-[var(--color-critical-ring)]',
        tone === 'good' && 'border-[var(--status-delivered-ring)]',
        className,
      )}
    >
      <p className="text-text-muted text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      <div
        className={clsx(
          'mt-1.5 text-xl font-semibold',
          tone === 'neutral' && 'text-text-bright',
          tone === 'warn' && 'text-[var(--status-pending-fg)]',
          tone === 'bad' && 'text-[var(--color-critical)]',
          tone === 'good' && 'text-[var(--status-delivered-fg)]',
        )}
      >
        {value}
      </div>
      {hint !== undefined && (
        <p className="text-text-faint mt-1 text-xs leading-snug">{hint}</p>
      )}
    </div>
  );
}

/** Key/value pairs for a detail pane. */
export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  readonly items: ReadonlyArray<{ label: string; value: ReactNode }>;
  readonly columns?: 1 | 2 | 3;
  readonly className?: string;
}): ReactElement {
  return (
    <dl
      className={clsx(
        'grid gap-x-6 gap-y-3',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-text-muted text-xs">{item.label}</dt>
          <dd className="text-text-strong mt-0.5 text-sm break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The bar above a table: filters left, actions right.
 *
 * Wraps rather than scrolls on narrow screens — a horizontally
 * scrolling toolbar hides its own controls, and the ops floor uses
 * tablets.
 */
export function Toolbar({
  children,
  actions,
  className,
}: {
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}): ReactElement {
  return (
    <div
      className={clsx(
        'border-border bg-surface-raised flex flex-wrap items-center gap-2 rounded-t-[var(--radius-3)] border border-b-0 px-3 py-2',
        className,
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
