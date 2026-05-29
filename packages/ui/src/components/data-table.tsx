import { clsx } from 'clsx';
import type {
  HTMLAttributes,
  ReactElement,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

/**
 * Dense data table primitive — utility wrappers over <table>.
 * Linear/Stripe dashboard density: 32-36px row height, 13px text,
 * tight cell padding, hairline borders. NO zebra stripes (visual
 * noise); single hover state for selection affordance.
 *
 * Extraction-ready (no `@/...` imports). Consumers compose with the
 * Th/Td atoms; the table itself is a styled wrapper.
 */

export function Table({
  className,
  ...rest
}: HTMLAttributes<HTMLTableElement>): ReactElement {
  return (
    <div className="rounded-[7px] border border-border bg-surface overflow-hidden">
      <table
        className={clsx('w-full border-collapse text-sm', className)}
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

export function Tr({
  className,
  interactive,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { readonly interactive?: boolean }): ReactElement {
  return (
    <tr
      className={clsx(
        interactive && 'hover:bg-surface-hover cursor-pointer transition-colors',
        className,
      )}
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

export function TableEmpty({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="px-4 py-8 text-center text-text-muted text-sm">{children}</div>
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
    <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-surface-raised text-text-muted text-xs">
      <div>
        Showing <span className="text-text-body font-medium">{start}–{end}</span> of{' '}
        <span className="text-text-body font-medium">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2 py-1 rounded-[3px] border border-border hover:border-border-strong hover:text-text-body disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Prev
        </button>
        <span className="text-text-faint">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded-[3px] border border-border hover:border-border-strong hover:text-text-body disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}
