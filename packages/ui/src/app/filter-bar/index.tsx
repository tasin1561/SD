import { clsx } from 'clsx';
import { SlidersHorizontal, X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from '../button';
import './filter-bar.css';

export interface FilterChip {
  readonly id: string;
  /** What it says — "Status: Delivered". */
  readonly label: string;
  readonly onRemove: () => void;
}

/**
 * FilterBar (u04). A card titled "Filters" with a badge counting the
 * active filters, the controls (children — each wrapped in a
 * `FilterField` for its leading icon), the active filters as removable
 * chips under the bar, a Reset link and, optionally, an accent Apply.
 *
 * Many app filters apply live (URL-driven); pass `onApply` only when the
 * filters are staged and need a commit. `activeCount` defaults to the
 * number of chips.
 */
export function FilterBar({
  title = 'Filters',
  activeCount,
  chips = [],
  onReset,
  onApply,
  applyLabel = 'Apply',
  applying = false,
  actions,
  children,
  className,
}: {
  readonly title?: ReactNode;
  readonly activeCount?: number | undefined;
  readonly chips?: readonly FilterChip[];
  readonly onReset?: (() => void) | undefined;
  readonly onApply?: (() => void) | undefined;
  readonly applyLabel?: string;
  /** Wire to the real request: the Apply button shows busy while true. */
  readonly applying?: boolean;
  /** Extra controls for the header's right edge. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  const count = activeCount ?? chips.length;
  return (
    <section className={clsx('sk-filter', className)} aria-label="Filters">
      <div className="sk-filter__head">
        <span className="sk-filter__icon" aria-hidden>
          <SlidersHorizontal size={16} />
        </span>
        <span className="sk-filter__title">{title}</span>
        <span className="sk-filter__count sk-figure" data-zero={count === 0 ? '1' : undefined}>
          {count === 0 ? 'None active' : `${count} active`}
        </span>
        <span className="sk-filter__head-actions">
          {actions}
          {onReset !== undefined && (
            <button
              type="button"
              className="sk-filter__reset"
              onClick={onReset}
              disabled={count === 0}
            >
              Reset
            </button>
          )}
          {onApply !== undefined && (
            <Button variant="primary" size="sm" onClick={onApply} loading={applying}>
              {applyLabel}
            </Button>
          )}
        </span>
      </div>
      <div className="sk-filter__controls">{children}</div>
      {chips.length > 0 && (
        <ul className="sk-filter__chips" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.id} className="sk-filter__chip">
              <span className="sk-filter__chip-label">{c.label}</span>
              <button
                type="button"
                className="sk-filter__chip-x"
                onClick={c.onRemove}
                aria-label={`Remove filter: ${c.label}`}
              >
                <X size={12} strokeWidth={2.5} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One control in the bar, led by an icon chip. The control itself — a
 * `Select`, a `TextField`, a date input — is the child, unchanged.
 */
export function FilterField({
  icon,
  children,
  wide = false,
  className,
}: {
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  /** Let this control take two columns (a search box). */
  readonly wide?: boolean;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <div className={clsx('sk-filter__field', className)} data-wide={wide ? '1' : undefined}>
      {icon !== undefined && (
        <span className="sk-filter__field-icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="sk-filter__field-control">{children}</div>
    </div>
  );
}
