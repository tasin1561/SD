'use client';

import { clsx } from 'clsx';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../button';
import { useUiT } from '../i18n-client';
import './filter-bar.css';

export interface FilterChip {
  readonly id: string;
  /** What it says — "Status: Delivered". */
  readonly label: string;
  readonly onRemove: () => void;
}

/** Below this width the bar folds behind a "Filters (n)" button. Keep in step with the CSS. */
const PHONE = '(max-width: 639.98px)';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * FilterBar — the filters above a list, as ONE compact bar.
 *
 * Wide screens: a single row (it wraps to a second row when narrow) of the
 * controls passed as children — search first and flexible, then the page's
 * selects and date range — with "Reset (n)" at the end, shown only while
 * something is filtered. No heading row and no card padding: a thin border
 * is all that marks it.
 *
 * Phones: the bar folds behind a "Filters (n)" button. The button sits in
 * the page header's title row when the page has one (`PageHeader` leaves a
 * slot for it), so the list starts right under the title; it opens the same
 * controls as a bottom sheet. The controls are rendered ONCE either way —
 * the sheet is the bar, restyled — so their state, labels and the URL they
 * write are exactly the same on every screen.
 *
 * Props are unchanged from the card it replaces: `title` names the sheet,
 * `activeCount` (default: number of chips) drives the counts, `onApply` is
 * for staged filters, `actions` sit at the bar's end.
 */
export function FilterBar({
  title,
  activeCount,
  chips = [],
  onReset,
  onApply,
  applyLabel,
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
  /** Extra controls for the bar's end. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  const t = useUiT();
  const count = activeCount ?? chips.length;
  const sheetId = `sk-filter-${useId()}`;
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const section = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The page header's slot, if this bar belongs to a page that has one.
  useIsoLayoutEffect(() => {
    const root = section.current?.closest('main') ?? document;
    setSlot(root.querySelector<HTMLElement>('.sk-ph__slot'));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia(PHONE);
    const onWide = (): void => {
      if (!mq.matches) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    const body = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mq.addEventListener('change', onWide);
    document.addEventListener('keydown', onKey);
    // The first filter, not the sheet's close button.
    const controls = panel.current?.querySelector('.sk-filter__controls');
    (
      controls?.querySelector<HTMLElement>('input, select, textarea, button') ??
      panel.current?.querySelector<HTMLElement>('button')
    )?.focus();
    return () => {
      document.body.style.overflow = body;
      mq.removeEventListener('change', onWide);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const label = typeof title === 'string' ? title : t('ui.filters.title');
  const toggle = (
    <button
      ref={trigger}
      type="button"
      className="sk-filter__toggle"
      data-active={count > 0 ? '1' : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={sheetId}
      onClick={() => setOpen(true)}
    >
      <SlidersHorizontal size={16} aria-hidden />
      <span>{count > 0 ? t('ui.filters.openN', { n: count }) : t('ui.filters.title')}</span>
    </button>
  );

  return (
    <section
      ref={section}
      className={clsx('sk-filter', className)}
      data-open={open ? '1' : undefined}
      data-slotted={slot !== null ? '1' : undefined}
      aria-label={label}
    >
      {slot !== null ? createPortal(toggle, slot) : toggle}
      {open && <div className="sk-filter__backdrop" aria-hidden onClick={close} />}
      <div
        ref={panel}
        id={sheetId}
        className="sk-filter__panel"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? label : undefined}
      >
        <div className="sk-filter__sheet-head">
          <span className="sk-filter__sheet-title">{title ?? t('ui.filters.title')}</span>
          <button
            type="button"
            className="sk-filter__sheet-x"
            aria-label={t('ui.close')}
            onClick={close}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="sk-filter__controls">{children}</div>
        <div className="sk-filter__end">
          {actions}
          {onReset !== undefined && count > 0 && (
            <button type="button" className="sk-filter__reset" onClick={onReset}>
              {t('ui.filters.resetN', { n: count })}
            </button>
          )}
          {onApply !== undefined && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onApply();
                if (open) close();
              }}
              loading={applying}
            >
              {applyLabel ?? t('ui.filters.apply')}
            </Button>
          )}
          {onApply === undefined && (
            <Button variant="primary" className="sk-filter__done" onClick={close}>
              {t('ui.done')}
            </Button>
          )}
        </div>
      </div>
      {chips.length > 0 && (
        <ul className="sk-filter__chips" aria-label={t('ui.filters.active')}>
          {chips.map((c) => (
            <li key={c.id} className="sk-filter__chip">
              <span className="sk-filter__chip-label">{c.label}</span>
              <button
                type="button"
                className="sk-filter__chip-x"
                onClick={c.onRemove}
                aria-label={t('ui.filters.remove', { label: c.label })}
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
 * One control in the bar. The control itself — a `Select`, a `TextField`,
 * a `DateRangeField` — is the child, unchanged. `wide` gives it the room a
 * search box needs. `icon` is accepted for older callers; the compact bar
 * does not draw it (the control's own label already says what it is).
 */
export function FilterField({
  children,
  wide = false,
  className,
}: {
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  /** Let this control take the spare width (a search box). */
  readonly wide?: boolean;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <div className={clsx('sk-filter__field', className)} data-wide={wide ? '1' : undefined}>
      <div className="sk-filter__field-control">{children}</div>
    </div>
  );
}
