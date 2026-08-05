'use client';

import { clsx } from 'clsx';
import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

/**
 * Dense data table primitive — utility wrappers over <table>.
 * Linear/Stripe dashboard density: 32-36px row height, 13px text,
 * tight cell padding, hairline borders. NO zebra stripes (visual
 * noise); single hover state for selection affordance.
 *
 * Extraction-ready (no `@/...` imports). Consumers compose with the
 * Th/Td atoms; the table itself is a styled wrapper.
 *
 * Below `md` the table becomes a stack of cards — see the
 * `.sd-table-cards` rules in tokens.css. The column labels for that
 * layout are stamped onto each cell here rather than being passed by
 * every call site: there are 40 tables across the two apps, and a
 * `label` prop on ~300 cells is 300 chances to forget one.
 */

/**
 * Copies each column's header text onto the cells beneath it as
 * `data-label`, which the card layout renders via `td::before`.
 *
 * Rows whose cell count does not match the header are left alone —
 * that is an empty state or a spanning row, and labelling those would
 * put "Order" in front of "No orders match this filter".
 *
 * A MutationObserver keeps it correct as the table re-renders with new
 * data. It watches childList only, so stamping attributes here cannot
 * re-trigger it.
 */
function useColumnLabels(enabled: boolean): React.RefObject<HTMLTableElement | null> {
  const ref = useRef<HTMLTableElement | null>(null);

  useEffect(() => {
    const table = ref.current;
    if (!enabled || table === null) return;

    const apply = (): void => {
      const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th')).map(
        (th) => (th.textContent ?? '').trim(),
      );
      if (headers.length === 0) return;

      for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'))) {
        const cells = row.children;
        if (cells.length !== headers.length) continue;
        for (let i = 0; i < cells.length; i += 1) {
          const cell = cells[i];
          const label = headers[i] ?? '';
          if (cell instanceof HTMLElement && cell.getAttribute('data-label') !== label) {
            cell.setAttribute('data-label', label);
          }
        }
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}

export function Table({
  className,
  wrapperClassName,
  responsive = true,
  ...rest
}: HTMLAttributes<HTMLTableElement> & {
  /** Styles the bordered wrapper, e.g. `rounded-t-none` when a
   *  <Toolbar/> sits directly on top. */
  readonly wrapperClassName?: string;
  /**
   * Set false to keep a real table at every width and scroll it
   * sideways instead. Worth it for a genuinely matrix-shaped table
   * (a zone × weight-slab rate card) where the grid IS the meaning
   * and one cell per line says nothing.
   */
  readonly responsive?: boolean;
}): ReactElement {
  const ref = useColumnLabels(responsive);
  return (
    <div
      className={clsx(
        'rounded-[7px] border border-border bg-surface overflow-x-auto',
        responsive && 'sd-table-cards-wrap',
        wrapperClassName,
      )}
    >
      <table
        ref={ref}
        className={clsx(
          'w-full border-collapse text-sm',
          responsive && 'sd-table-cards',
          className,
        )}
        {...rest}
      />
    </div>
  );
}

export function THead({
  className,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>): ReactElement {
  return (
    <thead
      className={clsx(
        'bg-surface-raised border-b border-border text-text-muted text-[11px] uppercase tracking-wide',
        className,
      )}
      {...rest}
    />
  );
}

export function TBody({
  className,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>): ReactElement {
  return <tbody className={clsx('divide-y divide-border', className)} {...rest} />;
}

/** Clicks that came from something with its own behaviour. */
const OWN_BEHAVIOUR = 'a, button, input, select, textarea, label, [role="button"]';

export function Tr({
  className,
  interactive,
  onActivate,
  onClick,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & {
  readonly interactive?: boolean;
  /**
   * Makes the WHOLE row respond, not just the cell with the link in it.
   *
   * `interactive` alone only paints a pointer cursor, so eight tables
   * looked clickable everywhere and answered in one cell — you aim at a
   * seller, hit the email column, and nothing happens.
   *
   * ── IT IS A POINTER CONVENIENCE, NOT THE ONLY WAY IN ─────────────
   * A `<tr>` cannot be tabbed to and has no Enter key, so a row that
   * navigates ONLY by row-click is unreachable by keyboard and silent to
   * a screen reader. Keep the real `<a>` in the primary cell — that is
   * the accessible path — and let this layer on top. Giving the row its
   * own tab stop would add a second, unlabelled one beside the link.
   *
   * ── TWO GUARDS, BOTH FROM REAL ANNOYANCES ───────────────────────
   *  - A click that started on a link, button or form control is left
   *    alone. Without it, "Deactivate" in a row would fire its confirm
   *    AND navigate away from the row it is about.
   *  - A click that ends a text SELECTION is ignored. Selecting an email
   *    to copy it ends in a click inside the row, and navigating away
   *    mid-copy is maddening in a way that is hard to attribute.
   */
  readonly onActivate?: () => void;
}): ReactElement {
  const clickable = interactive === true || onActivate !== undefined;
  return (
    <tr
      className={clsx(
        clickable && 'hover:bg-surface-hover cursor-pointer transition-colors',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (onActivate === undefined || event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest(OWN_BEHAVIOUR) !== null) return;
        // Selected TEXT, not `isCollapsed`. A Selection with no ranges is
        // specified as collapsed, but implementations disagree —
        // happy-dom reports it as non-collapsed, which made this guard
        // swallow every ordinary click and cost an hour to find. Asking
        // whether anything is actually selected means the same thing
        // everywhere.
        const selected =
          typeof window === 'undefined' ? '' : (window.getSelection()?.toString() ?? '');
        if (selected.trim() !== '') return;
        onActivate();
      }}
      {...rest}
    />
  );
}

export function Th({
  className,
  align = 'left',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & {
  readonly align?: 'left' | 'right' | 'center';
}): ReactElement {
  return (
    <th
      className={clsx(
        'px-3 py-2 font-medium',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...rest}
    />
  );
}

export function Td({
  className,
  align = 'left',
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  readonly align?: 'left' | 'right' | 'center';
}): ReactElement {
  return (
    <td
      className={clsx(
        'px-3 py-2 text-text-body',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...rest}
    />
  );
}

/**
 * The "nothing to show" row.
 *
 * Renders as a real `<tbody><tr><td>` — the previous `<div>` was an
 * invalid direct child of `<table>`, which browsers hoist out of the
 * table entirely, so the message rendered in the wrong place.
 *
 * `colSpan` must match the header, otherwise the cell does not span and
 * the message sits under the first column.
 */
export function TableEmpty({
  children,
  colSpan = 12,
}: {
  readonly children: ReactNode;
  readonly colSpan?: number;
}): ReactElement {
  return (
    <tbody>
      <tr>
        <td colSpan={colSpan} className="px-4 py-8 text-center text-text-muted text-sm">
          {children}
        </td>
      </tr>
    </tbody>
  );
}

export type SortDirection = 'asc' | 'desc';

/**
 * A sortable column header.
 *
 * `aria-sort` is the part that is easy to skip and shouldn't be: it is
 * how a screen-reader user learns the table is sorted at all, and by
 * which column. The arrow glyph alone conveys that to sighted users
 * only.
 *
 * The whole header is the button (not a small icon), so the touch
 * target is the full cell rather than a 12px chevron.
 */
export function SortableTh({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  align = 'left',
  className,
}: {
  readonly label: string;
  readonly columnKey: string;
  readonly activeKey: string | null;
  readonly direction: SortDirection;
  readonly onSort: (key: string) => void;
  readonly align?: 'left' | 'right' | 'center';
  readonly className?: string;
}): ReactElement {
  const active = activeKey === columnKey;
  return (
    <th
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={clsx('p-0 font-medium', className)}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={clsx(
          'hover:text-text-strong flex w-full items-center gap-1 px-3 py-2 transition-colors',
          align === 'right' && 'justify-end',
          align === 'center' && 'justify-center',
          active ? 'text-text-strong' : 'text-text-muted',
        )}
      >
        <span>{label}</span>
        <span aria-hidden className={clsx('text-[10px]', !active && 'opacity-0')}>
          {direction === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}

export function TablePaginator({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onPageChange: (next: number) => void;
}): ReactElement {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    // On a phone this sits under a stack of cards rather than inside a
    // bordered table, so it carries its own border there.
    <div className="border-border bg-surface-raised text-text-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[var(--radius-3)] border px-3 py-2 text-xs md:rounded-none md:border-0 md:border-t">
      <div>
        Showing{' '}
        <span className="text-text-body font-medium">
          {start}–{end}
        </span>{' '}
        of <span className="text-text-body font-medium">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="border-border hover:border-border-strong hover:text-text-body inline-flex min-h-[34px] items-center rounded-[5px] border px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-text-faint tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="border-border hover:border-border-strong hover:text-text-body inline-flex min-h-[34px] items-center rounded-[5px] border px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
