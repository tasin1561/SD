'use client';

import { useId, type InputHTMLAttributes, type ReactElement } from 'react';
import '../micro.css';
import './touches.css';

/** 15 · Supporting touches — small, mostly CSS, each a few lines. */

/** Sun ↔ moon: the rays retract and a mask slides in to carve the crescent. */
export function ThemeMorphIcon({ mode }: { mode: 'light' | 'dark' }): ReactElement {
  // One id per INSTANCE: two toggles on a page (header + drawer) shared a
  // mask id, and the drawer's disc resolved to the header's mask — which
  // sat inside a display:none subtree on a phone, so it rendered as a
  // grey blob.
  const maskId = `tm${useId().replace(/\W/g, '')}`;
  return (
    <svg className="mi mi-theme" viewBox="0 0 24 24" data-mode={mode} aria-hidden>
      <mask id={maskId}>
        <rect width="24" height="24" fill="#fff" />
        <circle className="mi-theme__mask" cx="12" cy="12" r="6" fill="#000" />
      </mask>
      <circle
        className="mi-theme__disc"
        cx="12"
        cy="12"
        r="5"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
      <g className="mi-theme__rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => (
          <line
            key={i}
            className="mi-theme__ray"
            x1="12"
            y1="2.5"
            x2="12"
            y2="4.5"
            style={{ transform: `rotate(${i * 45}deg)` }}
          />
        ))}
      </g>
    </svg>
  );
}

/** Accordion chevron → minus when open (reads `data-open` or an ancestor's aria-expanded). */
export function ChevronMorph({ open }: { open: boolean }): ReactElement {
  return (
    <svg className="mi mi-chev" viewBox="0 0 20 20" data-open={open} aria-hidden>
      <line
        className="mi-chev__a"
        x1="5"
        y1="10"
        x2="15"
        y2="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        className="mi-chev__b"
        x1="5"
        y1="10"
        x2="15"
        y2="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Copy icon → drawn tick once `done`. */
export function CopyTick({ done }: { done: boolean }): ReactElement {
  return (
    <svg className="mi mi-copy" viewBox="0 0 20 20" data-done={done} aria-hidden>
      <g className="mi-copy__doc" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="7" y="7" width="9" height="10" rx="1.5" />
        <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3H5.5A1.5 1.5 0 0 0 4 4.5v8A1.5 1.5 0 0 0 5.5 14H7" />
      </g>
      <path
        className="mi-copy__tick"
        d="M4 10.5l4 4 8-9"
        fill="none"
        stroke="var(--green-text)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A field whose label floats up on focus or when it holds a value. */
export function FloatingField({
  label,
  id,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }): ReactElement {
  return (
    <span className="mi mi-float">
      <input id={id} className="mi-float__input" placeholder=" " {...input} />
      <label htmlFor={id} className="mi-float__label">
        {label}
      </label>
    </span>
  );
}

/** Checkbox whose tick draws itself. */
export function DrawCheckbox({
  label,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string }): ReactElement {
  return (
    <label className="mi mi-check">
      <input type="checkbox" {...input} />
      <svg className="mi-check__box" viewBox="0 0 22 22" aria-hidden>
        <path
          className="mi-check__mark"
          d="M5 11.5l4 4 8-9"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[15px] text-fg-strong">{label}</span>
    </label>
  );
}

/** Toggle whose track fills as the knob slides. */
export function DrawToggle({
  label,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string }): ReactElement {
  return (
    <label className="inline-flex min-h-11 items-center gap-3 text-[15px] text-fg-strong">
      <span className="mi mi-toggle">
        <input type="checkbox" role="switch" {...input} />
        <span className="mi-toggle__word mi-toggle__word--on" aria-hidden>
          ON
        </span>
        <span className="mi-toggle__word mi-toggle__word--off" aria-hidden>
          OFF
        </span>
        <span className="mi-toggle__knob" />
      </span>
      {label}
    </label>
  );
}

/** Inline validation: a tick or a cross that draws itself; nothing while typing. */
export function ValidationIcon({ state }: { state: 'idle' | 'ok' | 'bad' }): ReactElement {
  return (
    <svg className="mi mi-valid" viewBox="0 0 20 20" data-state={state} aria-hidden>
      <path className="ok" d="M4 10.5l4 4 8-9" />
      <path className="bad" d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}
