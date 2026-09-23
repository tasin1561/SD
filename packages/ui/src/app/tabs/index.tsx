'use client';

import { clsx } from 'clsx';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ms, reducedMotion } from '../motion/motion';
import './tabs.css';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** A count badge after the label. */
  readonly count?: number | undefined;
  /** A route tab: renders a link and navigates (no panel). */
  readonly href?: string | undefined;
  /** The panel for an in-page tab. */
  readonly panel?: ReactNode;
  readonly disabled?: boolean | undefined;
}

/** next/link, passed in so the package takes no Next dependency. */
export type TabLink = ComponentType<{
  href: string;
  className: string;
  'aria-current': 'page' | undefined;
  tabIndex: number;
  'data-tab': string;
  onClick: () => void;
  children: ReactNode;
}>;

/**
 * Tabs (u09 + the storytelling "liquid bead"). ONE accent pill slides
 * between tabs and squashes-and-stretches as it travels; the panel
 * cross-fades and rises in.
 *
 * The pill is three pieces — two round caps and a middle scaled on X —
 * so it can change width with transforms only and its round ends never
 * distort.
 *
 * In-page tabs are a WAI-ARIA tablist: roving tabindex, arrow keys /
 * Home / End move AND select (automatic activation), panels are
 * `tabpanel`s labelled by their tab. Route tabs (every item has `href`)
 * are a `nav` of links with `aria-current="page"` — a tablist that
 * navigates is the wrong pattern — and there the arrow keys move focus
 * only. Controlled (`value` + `onChange`) or uncontrolled
 * (`defaultValue`).
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
  label,
  Link,
  size = 'md',
  fullWidth = false,
  className,
  panelClassName,
}: {
  readonly items: readonly TabItem[];
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onChange?: ((id: string) => void) | undefined;
  /** Names the tab set for assistive tech. */
  readonly label: string;
  readonly Link?: TabLink | undefined;
  readonly size?: 'sm' | 'md';
  readonly fullWidth?: boolean;
  readonly className?: string | undefined;
  readonly panelClassName?: string | undefined;
}): ReactElement {
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id ?? '');
  const selected = value ?? inner;
  const routes = items.length > 0 && items.every((t) => t.href !== undefined);
  const baseId = useId();
  const root = useRef<HTMLDivElement>(null);
  const prev = useRef<string | null>(null);
  const [moving, setMoving] = useState(false);

  const select = (id: string): void => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  useIsoLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    const place = (): void => {
      const active = el.querySelector<HTMLElement>(`[data-tab="${CSS.escape(selected)}"]`);
      if (active === null) {
        el.dataset.none = '1';
        return;
      }
      delete el.dataset.none;
      el.style.setProperty('--bead-x', `${active.offsetLeft}px`);
      el.style.setProperty('--bead-w', `${active.offsetWidth}px`);
      el.style.setProperty('--bead-h', `${active.offsetHeight}px`);
      // The middle strip is 1px wide and scaled: a unitless factor.
      el.style.setProperty(
        '--bead-mid',
        String(Math.max(0, active.offsetWidth - active.offsetHeight)),
      );
    };
    place();
    let t = 0;
    if (prev.current !== null && prev.current !== selected && !reducedMotion()) {
      setMoving(true);
      t = window.setTimeout(() => setMoving(false), ms(380));
    }
    // Enable the transition only after the first placement, so the pill
    // does not fly in from the left edge on mount.
    if (prev.current === null) {
      window.requestAnimationFrame(() => {
        el.dataset.ready = '1';
      });
    }
    prev.current = selected;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => {
      window.clearTimeout(t);
      ro?.disconnect();
    };
  }, [selected, items]);

  const enabled = items.filter((t) => t.disabled !== true);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const focused = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    const fromId = focused?.dataset.tab ?? selected;
    const i = enabled.findIndex((t) => t.id === fromId);
    if (i < 0) return;
    const next =
      e.key === 'ArrowRight'
        ? enabled[(i + 1) % enabled.length]
        : e.key === 'ArrowLeft'
          ? enabled[(i - 1 + enabled.length) % enabled.length]
          : e.key === 'Home'
            ? enabled[0]
            : e.key === 'End'
              ? enabled[enabled.length - 1]
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    root.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.id)}"]`)?.focus();
    if (!routes) select(next.id);
  };

  const tabId = (id: string): string => `${baseId}-tab-${id}`;
  const panelId = (id: string): string => `${baseId}-panel-${id}`;
  const current = items.find((t) => t.id === selected);

  const content = (t: TabItem): ReactElement => (
    <>
      {t.icon !== undefined && (
        <span className="sk-tabs__icon" aria-hidden>
          {t.icon}
        </span>
      )}
      <span className="sk-tabs__label">{t.label}</span>
      {t.count !== undefined && <span className="sk-tabs__count sk-figure">{t.count}</span>}
    </>
  );

  const bead = (
    <span className="sk-tabs__bead" aria-hidden>
      <span className="sk-tabs__cap sk-tabs__cap--l" />
      <span className="sk-tabs__mid" />
      <span className="sk-tabs__cap sk-tabs__cap--r" />
    </span>
  );

  const barClass = clsx(
    'sk-tabs__list',
    size === 'sm' && 'sk-tabs__list--sm',
    fullWidth && 'sk-tabs__list--full',
  );

  if (routes) {
    return (
      <nav className={clsx('sk-tabs', className)} aria-label={label}>
        <div
          ref={root}
          className={barClass}
          data-moving={moving ? '1' : undefined}
          onKeyDown={onKey}
        >
          {bead}
          {items.map((t) => {
            const on = t.id === selected;
            const cls = 'sk-tabs__tab';
            const href = t.href ?? '#';
            return Link !== undefined ? (
              <Link
                key={t.id}
                href={href}
                className={cls}
                aria-current={on ? 'page' : undefined}
                tabIndex={on ? 0 : -1}
                data-tab={t.id}
                onClick={() => select(t.id)}
              >
                {content(t)}
              </Link>
            ) : (
              <a
                key={t.id}
                href={href}
                className={cls}
                aria-current={on ? 'page' : undefined}
                tabIndex={on ? 0 : -1}
                data-tab={t.id}
                onClick={() => select(t.id)}
              >
                {content(t)}
              </a>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <div className={clsx('sk-tabs', className)}>
      <div
        ref={root}
        role="tablist"
        aria-label={label}
        className={barClass}
        data-moving={moving ? '1' : undefined}
        onKeyDown={onKey}
      >
        {bead}
        {items.map((t) => {
          const on = t.id === selected;
          return (
            <button
              key={t.id}
              id={tabId(t.id)}
              type="button"
              role="tab"
              className="sk-tabs__tab"
              aria-selected={on}
              aria-controls={t.panel !== undefined ? panelId(t.id) : undefined}
              tabIndex={on ? 0 : -1}
              disabled={t.disabled === true}
              data-tab={t.id}
              onClick={() => select(t.id)}
            >
              {content(t)}
            </button>
          );
        })}
      </div>
      {current !== undefined && current.panel !== undefined && (
        <div
          key={current.id}
          id={panelId(current.id)}
          role="tabpanel"
          aria-labelledby={tabId(current.id)}
          tabIndex={0}
          className={clsx('sk-tabs__panel', panelClassName)}
        >
          {current.panel}
        </div>
      )}
    </div>
  );
}
