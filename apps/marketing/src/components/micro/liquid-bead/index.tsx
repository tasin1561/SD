'use client';

import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import '../micro.css';
import './liquid-bead.css';

export interface BeadTab {
  id: string;
  label: ReactNode;
  /** A hue name from the token system — the bead takes `--{hue}-fill`. */
  hue: string;
}

/**
 * 8 · Liquid bead tablist. `role="tablist"` with arrow-key movement; the
 * bead is positioned from the active tab's measured offset (a CSS var, so
 * the slide is one transform) and coloured from that tab's hue token.
 * Controlled: the owner holds `value` and decides what a change means.
 */
export function LiquidBead({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly BeadTab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    const active = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    const tab = tabs.find((t) => t.id === value);
    if (!el || !active || !tab) return;
    el.style.setProperty('--bead-x', `${active.offsetLeft}px`);
    el.style.setProperty('--bead-w', `${active.offsetWidth}px`);
    el.style.setProperty('--bead-color', `var(--${tab.hue}-fill)`);
    el.style.setProperty('--bead-glow', `var(--${tab.hue}-glow)`);
    el.style.setProperty('--bead-on', `var(--${tab.hue}-on-fill)`);
  }, [value, tabs]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = tabs.findIndex((t) => t.id === value);
    if (i < 0) return;
    const next =
      e.key === 'ArrowRight'
        ? tabs[(i + 1) % tabs.length]
        : e.key === 'ArrowLeft'
          ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === 'Home'
            ? tabs[0]
            : e.key === 'End'
              ? tabs[tabs.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    root.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div ref={root} className="mi mi-bead" role="tablist" aria-label={label} onKeyDown={onKey}>
      <span className="mi-bead__bead" aria-hidden />
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          className="mi-bead__tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
