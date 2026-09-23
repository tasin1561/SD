'use client';

import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { Select } from '../select';
import './pagination.css';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type PageItem = number | 'gap-left' | 'gap-right';

/** 1 … 4 5 [6] 7 8 … 20 — first, last, and two either side of the page. */
export function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items: PageItem[] = [1];
  const from = Math.max(2, Math.min(page - 1, totalPages - 4));
  const to = Math.min(totalPages - 1, Math.max(page + 1, 5));
  if (from > 2) items.push('gap-left');
  for (let p = from; p <= to; p += 1) items.push(p);
  if (to < totalPages - 1) items.push('gap-right');
  items.push(totalPages);
  return items;
}

/**
 * Pagination (u16). Round prev / next, page numbers with an accent BUBBLE
 * that moves to the active page (one transform), an ellipsis for long
 * ranges, an "N / page" size select and a "Go to page" box, in one bar.
 *
 * API-compatible with the legacy `TablePaginator` (`page`, `pageSize`,
 * `total`, `onPageChange` — pages are 1-based), plus `onPageSizeChange`
 * and `pageSizes`; without `onPageSizeChange` the size select is hidden.
 * The "Showing 1–20 of 240" summary is a polite live region.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 20, 50, 100],
  showJump = true,
  label = 'Pagination',
  className,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onPageChange: (next: number) => void;
  readonly onPageSizeChange?: ((size: number) => void) | undefined;
  readonly pageSizes?: readonly number[];
  readonly showJump?: boolean;
  readonly label?: string;
  readonly className?: string | undefined;
}): ReactElement {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  const items = pageItems(current, totalPages);

  const pages = useRef<HTMLSpanElement>(null);
  const [jump, setJump] = useState('');

  useIsoLayoutEffect(() => {
    const el = pages.current;
    if (!el) return;
    const place = (): void => {
      const active = el.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      el.style.setProperty('--bub-x', `${active.offsetLeft}px`);
      el.dataset.ready = '1';
    };
    place();
    // A narrow screen hides the neighbour pages, which moves the active
    // one; re-place the bubble whenever the row changes size.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [current, totalPages]);

  const go = (p: number): void => {
    const next = Math.min(Math.max(1, p), totalPages);
    if (next !== current) onPageChange(next);
  };
  const onJump = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const n = Number.parseInt(jump, 10);
    if (Number.isFinite(n)) go(n);
    setJump('');
  };

  const sizeOptions = (pageSizes.includes(pageSize) ? pageSizes : [...pageSizes, pageSize])
    .slice()
    .sort((a, b) => a - b)
    .map((n) => ({ value: String(n), label: `${n} / page` }));

  return (
    <nav className={clsx('sk-pg', className)} aria-label={label}>
      <div className="sk-pg__summary" aria-live="polite">
        Showing{' '}
        <span className="sk-figure sk-pg__strong">
          {start}–{end}
        </span>{' '}
        of <span className="sk-figure sk-pg__strong">{total}</span>
      </div>
      <div className="sk-pg__bar">
        <button
          type="button"
          className="sk-pg__arrow"
          onClick={() => go(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span ref={pages} className="sk-pg__pages">
          <span className="sk-pg__bubble" aria-hidden />
          {items.map((it) =>
            typeof it === 'number' ? (
              <button
                key={it}
                type="button"
                className="sk-pg__page sk-figure"
                aria-current={it === current ? 'page' : undefined}
                data-edge={it === 1 || it === totalPages || it === current ? '1' : undefined}
                aria-label={`Page ${it} of ${totalPages}`}
                onClick={() => go(it)}
              >
                {it}
              </button>
            ) : (
              <span key={it} className="sk-pg__gap" data-edge="1" aria-hidden>
                …
              </span>
            ),
          )}
        </span>
        <button
          type="button"
          className="sk-pg__arrow"
          onClick={() => go(current + 1)}
          disabled={current >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
      {(onPageSizeChange !== undefined || (showJump && totalPages > 7)) && (
        <div className="sk-pg__tools">
          {onPageSizeChange !== undefined && (
            <div className="sk-pg__size">
              <Select
                label="Rows per page"
                value={String(pageSize)}
                onChange={(e) => onPageSizeChange(Number(e.currentTarget.value))}
              >
                {sizeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {showJump && totalPages > 7 && (
            <form className="sk-pg__jump" onSubmit={onJump}>
              <label className="sk-pg__jump-label" htmlFor={`${label}-jump`}>
                Go to page
              </label>
              <input
                id={`${label}-jump`}
                className="sk-pg__jump-input sk-figure"
                inputMode="numeric"
                pattern="[0-9]*"
                value={jump}
                onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))}
                placeholder={String(current)}
                aria-describedby={`${label}-jump-max`}
              />
              <span id={`${label}-jump-max`} className="sk-pg__jump-max">
                of {totalPages}
              </span>
            </form>
          )}
        </div>
      )}
    </nav>
  );
}
