'use client';

import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import '../micro.css';
import './reactive-mascot.css';

/**
 * 13 · Reactive mascot — an ORIGINAL parcel character (a taped box with
 * eyes), never a licensed one. Eyes follow the pointer, or the caret when
 * `watch` names an input; `mood="happy"` after a real success. No password
 * field on the marketing site, so no cover-eyes beat.
 */
export function ReactiveMascot({
  watch,
  mood = 'neutral',
}: {
  watch?: React.RefObject<HTMLElement | null>;
  mood?: 'neutral' | 'happy';
}): ReactElement {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const look = (x: number, y: number): void => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / 160));
      const dy = Math.max(-1, Math.min(1, (y - (r.top + r.height / 2)) / 160));
      el.style.setProperty('--ex', `${(dx * 3).toFixed(1)}px`);
      el.style.setProperty('--ey', `${(dy * 2.5).toFixed(1)}px`);
    };
    const onMove = (e: PointerEvent): void => look(e.clientX, e.clientY);
    const onInput = (): void => {
      const t = watch?.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const len = t instanceof HTMLInputElement ? t.value.length : 0;
      look(r.left + Math.min(r.width, 12 + len * 8), r.top + r.height / 2);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    const t = watch?.current;
    t?.addEventListener('input', onInput);
    t?.addEventListener('focus', onInput);
    return () => {
      window.removeEventListener('pointermove', onMove);
      t?.removeEventListener('input', onInput);
      t?.removeEventListener('focus', onInput);
    };
  }, [watch]);
  return (
    <svg
      ref={ref}
      className="mi mi-mascot"
      viewBox="0 0 72 64"
      data-mood={mood}
      aria-hidden
      style={{} as CSSProperties}
    >
      <rect x="8" y="16" width="56" height="44" rx="6" fill="var(--saffron-fill)" />
      <rect x="32" y="16" width="8" height="44" fill="var(--saffron-on-fill)" opacity=".18" />
      <path d="M8 22l28-8 28 8" fill="none" stroke="var(--saffron-600)" strokeWidth="2" />
      <g className="mi-mascot__eye">
        <circle cx="26" cy="34" r="4" fill="var(--slate-950)" />
        <circle cx="46" cy="34" r="4" fill="var(--slate-950)" />
        <circle cx="27.5" cy="32.5" r="1.2" fill="#fff" />
        <circle cx="47.5" cy="32.5" r="1.2" fill="#fff" />
      </g>
      <rect
        className="mi-mascot__lid"
        x="20"
        y="28"
        width="32"
        height="12"
        fill="var(--saffron-fill)"
      />
      <path
        className="mi-mascot__mouth"
        d="M30 44q6 3 12 0"
        fill="none"
        stroke="var(--slate-950)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
