'use client';

import { CalendarRange, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Button } from '../button';
import { DateField } from '../date-field';
import { useLocale, useUiT } from '../i18n-client';
import { FieldShell } from '../text-field';
import './date-range.css';

/**
 * DateRangeField — one field for a from–to date filter.
 *
 * Replaces a pair of wide date inputs ("Placed from" / "Placed to") with one
 * control the size of a select: it reads "Any time" or "12 Nov – 20 Nov",
 * and opens a small panel with the two dates and a few quick ranges.
 *
 * Values are the same `YYYY-MM-DD` strings the two inputs produced, and
 * every change is reported at once (no Apply step), so a page wires it to
 * exactly the URL params it used before: `onChange({ from, to })`.
 *
 * Inside the phone filter sheet the panel opens in place, under the field.
 */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The quick ranges, counted on this device's calendar. */
export function presetRange(
  kind: 'today' | 'last7' | 'last30' | 'thisMonth',
  now: Date = new Date(),
): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = (days: number): Date =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  switch (kind) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case 'last7':
      return { from: iso(back(6)), to: iso(today) };
    case 'last30':
      return { from: iso(back(29)), to: iso(today) };
    case 'thisMonth':
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  }
}

const TAGS = { en: 'en-IN', bn: 'bn-BD-u-nu-latn', hi: 'hi-IN-u-nu-latn' } as const;

function shortDate(value: string, locale: keyof typeof TAGS, thisYear: number): string {
  const [y, m, d] = value.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y)) return value;
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(TAGS[locale], {
    day: 'numeric',
    month: 'short',
    ...(y === thisYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export function DateRangeField({
  label,
  from,
  to,
  onChange,
  fromLabel,
  toLabel,
  className,
}: {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly onChange: (next: DateRange) => void;
  /** Labels of the two dates inside the panel. Default "From" / "To". */
  readonly fromLabel?: string | undefined;
  readonly toLabel?: string | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  const t = useUiT();
  const locale = useLocale();
  const id = `sk-dr-${useId()}`;
  const panelId = `${id}-panel`;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  const thisYear = new Date().getFullYear();
  const shown =
    from !== '' && to !== ''
      ? from === to
        ? shortDate(from, locale, thisYear)
        : `${shortDate(from, locale, thisYear)} – ${shortDate(to, locale, thisYear)}`
      : from !== ''
        ? t('ui.dateRange.since', { date: shortDate(from, locale, thisYear) })
        : to !== ''
          ? t('ui.dateRange.until', { date: shortDate(to, locale, thisYear) })
          : t('ui.dateRange.any');
  const set = from !== '' || to !== '';

  return (
    <div
      ref={wrap}
      className={className === undefined ? 'sk-dr' : `sk-dr ${className}`}
      data-open={open ? '1' : undefined}
    >
      <FieldShell
        id={id}
        label={label}
        float
        variant="sk-select sk-dr__field"
        trail={
          <span className="sk-field__trail sk-dr__icon" aria-hidden>
            <CalendarRange size={17} />
          </span>
        }
      >
        <button
          ref={trigger}
          id={id}
          type="button"
          className="sk-field__input sk-dr__btn"
          data-set={set ? '1' : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sk-dr__value">{shown}</span>
        </button>
      </FieldShell>

      {open && (
        <div id={panelId} className="sk-dr__panel" role="dialog" aria-label={label}>
          <div className="sk-dr__presets">
            {(['today', 'last7', 'last30', 'thisMonth'] as const).map((k) => {
              const r = presetRange(k);
              const on = r.from === from && r.to === to;
              return (
                <button
                  key={k}
                  type="button"
                  className="sk-dr__preset"
                  aria-pressed={on}
                  onClick={() => onChange(r)}
                >
                  {t(`ui.dateRange.${k}`)}
                </button>
              );
            })}
          </div>
          <div className="sk-dr__dates">
            <DateField
              label={fromLabel ?? t('ui.dateRange.from')}
              value={from}
              max={to || undefined}
              onChange={(e) => onChange({ from: e.target.value, to })}
            />
            <DateField
              label={toLabel ?? t('ui.dateRange.to')}
              value={to}
              min={from || undefined}
              onChange={(e) => onChange({ from, to: e.target.value })}
            />
          </div>
          <div className="sk-dr__foot">
            {set && (
              <button
                type="button"
                className="sk-dr__clear"
                onClick={() => onChange({ from: '', to: '' })}
              >
                <X size={14} aria-hidden />
                {t('ui.dateRange.clear')}
              </button>
            )}
            <Button size="sm" variant="primary" className="sk-dr__done" onClick={() => close(true)}>
              {t('ui.done')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
