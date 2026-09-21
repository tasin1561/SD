'use client';

import type { ReactElement } from 'react';
import { Moon, Sun } from 'lucide-react';
import '../micro.css';
import './theme-switch.css';

/**
 * 29 · Theme switch (u14). A tactile pill: both icons sit in the track,
 * the knob carries the active one (a warm sun, a cool moon), an inner
 * shadow and highlight give it depth, and the whole control re-skins with
 * the theme. `role="switch"`; the knob slides with a slight overshoot on
 * transform only. The View Transition cross-fade lives in the caller.
 */
export function ThemeSwitch({
  dark,
  onChange,
  className,
}: {
  dark: boolean;
  onChange: (dark: boolean) => void;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`mi mi-theme-sw ${className ?? ''}`}
      data-dark={dark}
      onClick={() => onChange(!dark)}
    >
      <span className="mi-theme-sw__track" aria-hidden>
        <Sun size={14} className="mi-theme-sw__ico mi-theme-sw__ico--sun" />
        <Moon size={14} className="mi-theme-sw__ico mi-theme-sw__ico--moon" />
        <span className="mi-theme-sw__knob">
          <Sun size={14} className="mi-theme-sw__k mi-theme-sw__k--sun" />
          <Moon size={14} className="mi-theme-sw__k mi-theme-sw__k--moon" />
        </span>
      </span>
    </button>
  );
}
