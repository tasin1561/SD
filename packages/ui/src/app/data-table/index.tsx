'use client';

import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { Checkbox } from '../checkbox';
import './data-table.css';

/**
 * DataTable (u07) — the legacy Table API (`Table`, `THead`, `TBody`,
 * `Tr` with `interactive`/`onActivate`, `Th`/`Td` with `align`,
 * `SortableTh` with `aria-sort`, `TableEmpty`) on the brand skin, plus a
 * toolbar, a selection column and a row-action slot.
 *
 * Premium moves: an accent-tinted header (sticky inside the table when it
 * is given a `maxHeight`), a row that lifts and grows a left accent bar on
 * HOVER — and no per-row entrance animation, ever: a list that animates
 * every row on each refetch is noise.
 *
 * Mobile: below `md` each row becomes a card, exactly as before — the
 * same `.sd-table-cards` classes from `brand/legacy.css` and the same
 * runtime stamping of each column's header onto its cells as
 * `data-label`, so no call site passes a label per cell.
 */

/** Copies each column's header text onto the cells under it as `data-label`. */
function useColumnLabels(enabled: boolean): RefObject<HTMLTableElement | null> {
  const ref = useRef<HTMLTableElement | null>(null);
  useEffect(() => {
    const table = ref.current;
    if (!enabled || table === null) return;
    const apply = (): void => {
      const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th')).map(
        (th) => (th.getAttribute('data-label') ?? th.textContent ?? '').trim(),
      );
      if (headers.length === 0) return;
      for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'))) {
        const cells = row.children;
        // A spanning row (empty state) is left alone.
        if (cells.length !== headers.length) continue;
        for (let i = 0; i < cells.length; i += 1) {
          const cell = cells[i];
          const text = headers[i] ?? '';
          if (cell instanceof HTMLElement && cell.getAttribute('data-label') !== text) {
            cell.setAttribute('data-label', text);
          }
        }
      }
    };
    apply();
    // childList only: stamping attributes here cannot re-trigger it.
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
  maxHeight,
  caption,
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement> & {
  readonly wrapperClassName?: string | undefined;
  /** False keeps a real grid at every width (a matrix-shaped table). */
  readonly responsive?: boolean;
  /** Scroll the body inside the card; the header then sticks. */
  readonly maxHeight?: string | number | undefined;
  /** A visually hidden caption naming the table. */
  readonly caption?: string | undefined;
}): ReactElement {
  const ref = useColumnLabels(responsive);
  const style: CSSProperties = {};
  if (maxHeight !== undefined) style.maxHeight = maxHeight;
  return (
    <div
      className={clsx('sk-table-wrap', responsive && 'sd-table-cards-wrap', wrapperClassName)}
      data-scroll={maxHeight !== undefined ? '1' : undefined}
      style={style}
    >
      <table
        ref={ref}
        className={clsx('sk-table', responsive && 'sd-table-cards', className)}
        {...rest}
      >
        {caption !== undefined && <caption className="sk-table__caption">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({
  className,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>): ReactElement {
  return <thead className={clsx('sk-thead', className)} {...rest} />;
}

export function TBody({
  className,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>): ReactElement {
  return <tbody className={clsx('sk-tbody', className)} {...rest} />;
}

/** Clicks that came from something with its own behaviour. */
const OWN_BEHAVIOUR =
  'a, button, input, select, textarea, label, [role="button"], [role="checkbox"]';

/**
 * A row. `onActivate` makes the WHOLE row respond — a pointer
 * convenience ON TOP of the real link in the primary cell, which stays
 * the keyboard and screen-reader path. Clicks on controls and clicks that
 * end a text selection are ignored (both are real annoyances otherwise).
 */
export function Tr({
  className,
  interactive,
  onActivate,
  selected,
  onClick,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & {
  readonly interactive?: boolean | undefined;
  readonly onActivate?: (() => void) | undefined;
  readonly selected?: boolean | undefined;
}): ReactElement {
  const clickable = interactive === true || onActivate !== undefined;
  return (
    <tr
      className={clsx('sk-tr', className)}
      data-clickable={clickable ? '1' : undefined}
      data-selected={selected === true ? '1' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (onActivate === undefined || event.defaultPrevented) return;
        const target = event.target;
        if (target instanceof Element && target.closest(OWN_BEHAVIOUR) !== null) return;
        const picked =
          typeof window === 'undefined' ? '' : (window.getSelection()?.toString() ?? '');
        if (picked.trim() !== '') return;
        onActivate();
      }}
      {...rest}
    />
  );
}

type Align = 'left' | 'right' | 'center';

export function Th({
  className,
  align = 'left',
  scope = 'col',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { readonly align?: Align }): ReactElement {
  return <th scope={scope} className={clsx('sk-th', className)} data-align={align} {...rest} />;
}

export function Td({
  className,
  align = 'left',
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { readonly align?: Align }): ReactElement {
  return <td className={clsx('sk-td', className)} data-align={align} {...rest} />;
}

/** The "nothing to show" row — a ROW, it goes inside a `<TBody>`. */
export function TableEmpty({
  children,
  colSpan = 12,
}: {
  readonly children: ReactNode;
  readonly colSpan?: number;
}): ReactElement {
  return (
    <tr className="sk-tr-empty">
      <td colSpan={colSpan} className="sk-td-empty">
        {children}
      </td>
    </tr>
  );
}

export type SortDirection = 'asc' | 'desc';

/**
 * A sortable header: the whole cell is the button, and `aria-sort` tells a
 * screen reader which column is sorted and which way.
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
  readonly align?: Align;
  readonly className?: string | undefined;
}): ReactElement {
  const active = activeKey === columnKey;
  const Icon = !active ? ChevronsUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={clsx('sk-th sk-th--sort', className)}
      data-align={align}
      data-label={label}
    >
      <button
        type="button"
        className="sk-th__sort"
        data-active={active ? '1' : undefined}
        onClick={() => onSort(columnKey)}
      >
        <span>{label}</span>
        <Icon size={13} aria-hidden className="sk-th__sort-icon" />
      </button>
    </th>
  );
}

/** Tri-state selection over a set of row ids. */
export interface RowSelection {
  readonly selected: ReadonlySet<string>;
  readonly isSelected: (id: string) => boolean;
  readonly toggle: (id: string, on?: boolean) => void;
  readonly toggleAll: (on: boolean) => void;
  readonly clear: () => void;
  /** For the select-all box: true, false or 'indeterminate'. */
  readonly allState: boolean | 'indeterminate';
  readonly count: number;
}

/** Selection state for the rows on screen; ids that leave `ids` drop out. */
export function useRowSelection(ids: readonly string[]): RowSelection {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  // `key` stands in for the array's CONTENTS: a new array holding the same
  // ids must not reset or recompute anything.
  const key = ids.join('\u0000');
  const idsRef = useRef(ids);
  idsRef.current = ids;
  useEffect(() => {
    const live = idsRef.current;
    setPicked((prev) => {
      const next = new Set(Array.from(prev).filter((id) => live.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [key]);
  const toggle = useCallback((id: string, on?: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const want = on ?? !prev.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback((on: boolean) => {
    setPicked(on ? new Set(idsRef.current) : new Set());
  }, []);
  const clear = useCallback(() => setPicked(new Set()), []);
  return useMemo(() => {
    const live = key === '' ? [] : key.split('\u0000');
    const count = live.filter((id) => picked.has(id)).length;
    const allState: boolean | 'indeterminate' =
      count === 0 ? false : count === live.length ? true : 'indeterminate';
    return {
      selected: picked,
      isSelected: (id: string) => picked.has(id),
      toggle,
      toggleAll,
      clear,
      allState,
      count,
    };
  }, [picked, key, toggle, toggleAll, clear]);
}

/** The select-all header cell. */
export function SelectAllTh({
  selection,
  label = 'Select all rows',
}: {
  readonly selection: RowSelection;
  readonly label?: string;
}): ReactElement {
  return (
    <th scope="col" className="sk-th sk-th--select" data-label="">
      <Checkbox
        checked={selection.allState === true}
        indeterminate={selection.allState === 'indeterminate'}
        onChange={(e) => selection.toggleAll(e.currentTarget.checked)}
        label={label}
        hideLabel
      />
    </th>
  );
}

/** A row's selection cell. `label` names the row: "Select SD-2026-26-000123". */
export function SelectTd({
  selection,
  id,
  label,
}: {
  readonly selection: RowSelection;
  readonly id: string;
  readonly label: string;
}): ReactElement {
  return (
    <td className="sk-td sk-td--select">
      <Checkbox
        checked={selection.isSelected(id)}
        onChange={(e) => selection.toggle(id, e.currentTarget.checked)}
        label={label}
        hideLabel
      />
    </td>
  );
}

/** The row-action slot, right-aligned; its header should read "Actions". */
export function RowActions({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <td className="sk-td sk-td--actions" data-align="right">
      <span className="sk-row-actions">{children}</span>
    </td>
  );
}

/**
 * The bar on top of a table: a search box, a filters slot and the primary
 * action (an accent "Add"). With `selectedCount` it shows the bulk-action
 * slot instead of the filters.
 */
export function TableToolbar({
  search,
  filters,
  action,
  selectedCount = 0,
  bulkActions,
  children,
  className,
}: {
  readonly search?:
    | {
        readonly value: string;
        readonly onChange: (value: string) => void;
        readonly label: string;
        readonly placeholder?: string | undefined;
      }
    | undefined;
  readonly filters?: ReactNode;
  readonly action?: ReactNode;
  readonly selectedCount?: number;
  readonly bulkActions?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  const bulk = selectedCount > 0 && bulkActions !== undefined;
  return (
    <div className={clsx('sk-toolbar', className)} data-bulk={bulk ? '1' : undefined}>
      {search !== undefined && (
        <label className="sk-toolbar__search">
          <Search size={15} className="sk-toolbar__search-icon" aria-hidden />
          <span className="sk-toolbar__sr">{search.label}</span>
          <input
            type="search"
            className="sk-toolbar__search-input"
            value={search.value}
            placeholder={search.placeholder ?? search.label}
            onChange={(e) => search.onChange(e.target.value)}
          />
        </label>
      )}
      {bulk ? (
        <div className="sk-toolbar__bulk" aria-live="polite">
          <span className="sk-toolbar__bulk-count sk-figure">{selectedCount} selected</span>
          {bulkActions}
        </div>
      ) : (
        filters !== undefined && <div className="sk-toolbar__filters">{filters}</div>
      )}
      {children}
      {action !== undefined && <div className="sk-toolbar__action">{action}</div>}
    </div>
  );
}
