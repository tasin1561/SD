'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ms, reducedMotion } from '../motion';
import '../micro.css';
import './liquid-bead.css';

export interface BeadTab {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** A hue name from the token system — the bead takes `--{hue}-fill`. */
  hue: string;
  /** For the icon bar: a link tab navigates (the owner still learns of the change). */
  href?: string;
}

/**
 * 8 · Liquid bead tablist, two variants.
 *   pill — text tabs; the pill stretches and squashes as it travels
 *          (`is-moving` re-arms the squash keyframe on every change).
 *   icon — an icon bar; the active icon lifts out of the bar on a rising
 *          circular bead in the item's accent, glow beneath.
 * `role="tablist"` with arrow-key movement; the bead is positioned from
 * the active tab's measured offset (CSS vars, so the slide is one
 * transform) and coloured from that tab's hue tokens. Controlled.
 */
export function LiquidBead({
  tabs,
  value,
  onChange,
  label,
  variant = 'pill',
  className,
}: {
  tabs: readonly BeadTab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  variant?: 'pill' | 'icon';
  className?: string;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  const prev = useRef(value);

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
    el.style.setProperty('--bead-text', `var(--${tab.hue}-text)`);
    if (prev.current !== value && variant === 'pill' && !reducedMotion()) {
      setMoving(true);
      const t = window.setTimeout(() => setMoving(false), ms(340));
      prev.current = value;
      return () => window.clearTimeout(t);
    }
    prev.current = value;
    return undefined;
  }, [value, tabs, variant]);

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
    <div
      ref={root}
      className={`mi mi-bead mi-bead--${variant}${moving ? ' is-moving' : ''} ${className ?? ''}`}
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
    >
      <span className="mi-bead__bead" aria-hidden />
      {tabs.map((t) => {
        const selected = t.id === value;
        const inner = (
          <>
            {t.icon ? <span className="mi-bead__ico">{t.icon}</span> : null}
            <span>{t.label}</span>
          </>
        );
        return t.href ? (
          <a
            key={t.id}
            href={t.href}
            role="tab"
            data-tab={t.id}
            className="mi-bead__tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {inner}
          </a>
        ) : (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            className="mi-bead__tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
