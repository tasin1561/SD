'use client';

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Money, useMoneyDisplay } from '@skydrop/ui/components';
import { Odometer } from '@skydrop/ui/app/kpi-card';
import { useT } from '@/i18n/client';
import './orders.css';

/**
 * Display-only pieces for the orders LIST page (density pass). Nothing
 * here fetches or decides: the page hands over ready values and callbacks.
 */

/**
 * `<Money>` with its second currency moved out of the row and into a
 * tooltip. Money prints "≈৳…" beside the figure from the ambient display
 * context; in a dense row that is a second line, so CSS hides it and the
 * same figure is restated in `title`. Same maths as Money's own.
 */
export function OrdMoney({ amount }: { readonly amount: string | number }): ReactElement {
  const display = useMoneyDisplay();
  const n = Number(amount);
  let title: string | undefined;
  if (display.equivalentRate != null && Number.isFinite(n) && n !== 0) {
    const converted = display.currency !== 'INR' && display.rate !== null;
    const shown = converted ? n * Number(display.rate) : n;
    const otherSymbol = converted ? '₹' : '৳';
    const eq = Math.abs(shown) * Number(display.equivalentRate);
    if (Number.isFinite(eq)) {
      title = `≈ ${otherSymbol}${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(eq)}`;
    }
  }
  return (
    <span className="ord-money" title={title}>
      <Money amount={amount} />
    </span>
  );
}

/** "27 Sep, 13:25" in UTC, like the ISO slice it replaces (stable across SSR). */
export function formatPlaced(iso: string, locale: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const hm = d.toISOString().slice(11, 16);
  return `${day} ${month}, ${hm}`;
}

export type KpiTint = 'neutral' | 'warn' | 'info' | 'good' | 'bad';

export interface KpiSegment {
  readonly id: string;
  readonly label: string;
  readonly tint: KpiTint;
  /** Undefined while loading: a dash, never a false 0. */
  readonly value: number | undefined;
  readonly foot: ReactNode;
  readonly active: boolean;
  readonly onSelect: () => void;
}

/**
 * ONE bordered bar of equal segments. Each segment is a real button that
 * applies its status filter (aria-pressed marks the one in force). On a
 * narrow screen the bar becomes a horizontal scroll-snap row.
 */
export function KpiStrip({
  label,
  segments,
}: {
  readonly label: string;
  readonly segments: readonly KpiSegment[];
}): ReactElement {
  return (
    <div className="ord-kpibar" role="group" aria-label={label}>
      {segments.map((s) => (
        <button
          key={s.id}
          type="button"
          className="ord-kpibar__seg"
          data-tint={s.tint}
          aria-pressed={s.active}
          onClick={s.onSelect}
        >
          <span className="ord-kpibar__label">{s.label}</span>
          <span className="ord-kpibar__num">
            {s.value === undefined ? <span aria-label="…">—</span> : <Odometer value={s.value} />}
          </span>
          <span className="ord-kpibar__foot">{s.foot}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The "More" popover: the full status list and the custom date range.
 * Closes on Escape and on a press outside it; focus returns to the button.
 */
export function MoreFilters({
  open,
  setOpen,
  activeCount,
  status,
  statuses,
  onStatus,
  from,
  to,
  onFrom,
  onTo,
  showDates,
}: {
  readonly open: boolean;
  readonly setOpen: (next: boolean) => void;
  readonly activeCount: number;
  readonly status: string;
  readonly statuses: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly onStatus: (value: string) => void;
  readonly from: string;
  readonly to: string;
  readonly onFrom: (value: string) => void;
  readonly onTo: (value: string) => void;
  readonly showDates: boolean;
}): ReactElement {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div className="ord-more" ref={root}>
      <button
        ref={btn}
        type="button"
        className="ord-ctl ord-more__btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('orderList.moreFilters')}
        onClick={() => setOpen(!open)}
      >
        {t('orderList.more')}
        <ChevronDown size={14} aria-hidden className="ord-more__chev" />
      </button>
      {open && (
        <div className="ord-more__panel" role="dialog" aria-label={t('orderList.moreFilters')}>
          <div className="ord-more__group" role="group" aria-label={t('orderList.filterByStatus')}>
            <span className="ord-more__h">{t('orderList.status')}</span>
            <div className="ord-more__list">
              {[{ value: '', label: t('orderList.allStatuses') }, ...statuses].map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className="ord-more__opt"
                  aria-pressed={status === s.value}
                  onClick={() => onStatus(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {showDates && (
            <div className="ord-more__group" role="group" aria-label={t('orderList.customDates')}>
              <span className="ord-more__h">{t('orderList.customDates')}</span>
              <div className="ord-more__dates">
                <label className="ord-more__date">
                  <span>{t('orderList.from')}</span>
                  <input
                    type="date"
                    className="ord-ctl"
                    aria-label={t('orderList.placedFrom')}
                    value={from}
                    max={to === '' ? undefined : to}
                    onChange={(e) => onFrom(e.target.value)}
                  />
                </label>
                <label className="ord-more__date">
                  <span>{t('orderList.to')}</span>
                  <input
                    type="date"
                    className="ord-ctl"
                    aria-label={t('orderList.placedTo')}
                    value={to}
                    min={from === '' ? undefined : from}
                    onChange={(e) => onTo(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
      {activeCount > 0 && <span className="ord-more__dot" aria-hidden />}
    </div>
  );
}
