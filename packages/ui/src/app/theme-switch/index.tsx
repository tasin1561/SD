'use client';

import { clsx } from 'clsx';
import { Moon, Sun } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  DEFAULT_THEME,
  pinnedTheme,
  THEME_STORAGE_KEY,
  writeThemeCookie,
  type PinnedTheme,
} from '../../components/theme-init';
import { reducedMotion } from '../motion/motion';
import './theme-switch.css';

/**
 * Light or dark, and nothing else (owner, 2026-10-26).
 *
 * There was a third position, System, which worked by clearing the pin
 * and letting `prefers-color-scheme` decide. It is gone: the product
 * now opens light for everybody and the only question the switch asks
 * is which of the two you want. `ThemeMode` is kept as a name for
 * `PinnedTheme` so call sites outside this file do not have to change.
 */
export type ThemeMode = PinnedTheme;

const MODES: readonly { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
];

/** Put a mode on <html>, localStorage and the cookie the server renders from. Never throws. */
function applyMode(mode: ThemeMode): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage blocked: the cookie below still carries it.
  }
  writeThemeCookie(mode);
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => unknown };

/**
 * Theme switch (u14) with THREE positions, because the theme now follows
 * the OS when nothing is pinned: System / Light / Dark. All three icons sit
 * in the track; the knob slides to the chosen one and carries its icon
 * (a warm sun, a cool moon, the accent screen). System clears the pin.
 *
 * It writes exactly what the legacy ThemeToggle wrote — `data-theme` on
 * <html>, localStorage `sd-theme` and the `sd-theme` cookie the root layout
 * renders from — follows a change made in another tab, and cross-fades
 * through a View Transition where the browser has one.
 *
 * ARIA: a radiogroup of three radios; arrow keys move and select, one tab
 * stop. Inert until mounted (the server cannot know the stored choice).
 */
export function ThemeSwitch({ className }: { className?: string | undefined }): ReactElement {
  const [mode, setMode] = useState<ThemeMode | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let pinned = pinnedTheme(document.documentElement.getAttribute('data-theme'));
    // Put back a pin lost to a React root reset (see theme-init.ts).
    try {
      const stored = pinnedTheme(localStorage.getItem(THEME_STORAGE_KEY));
      if (stored !== undefined && stored !== pinned) {
        document.documentElement.setAttribute('data-theme', stored);
        pinned = stored;
      }
    } catch {
      // Storage unavailable: trust <html>.
    }
    // No pin means light: the same default the init script stamps
    // and the root layout renders, so the knob agrees with the page.
    setMode(pinned ?? DEFAULT_THEME);

    function onStorage(e: StorageEvent): void {
      if (e.key !== THEME_STORAGE_KEY) return;
      // A cleared value in another tab falls back to light rather than
      // to an unthemed <html>, which would show the dark `:root`.
      const next = pinnedTheme(e.newValue) ?? DEFAULT_THEME;
      document.documentElement.setAttribute('data-theme', next);
      setMode(next);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function choose(next: ThemeMode): void {
    if (next === mode) return;
    setMode(next);
    const doc = document as ViewTransitionDoc;
    if (typeof doc.startViewTransition === 'function' && !reducedMotion()) {
      doc.startViewTransition(() => applyMode(next));
    } else {
      applyMode(next);
    }
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const target = (index + step + MODES.length) % MODES.length;
    const m = MODES[target];
    if (m === undefined) return;
    choose(m.mode);
    radios.current[target]?.focus();
  }

  const index = mode === null ? 0 : MODES.findIndex((m) => m.mode === mode);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={clsx('sk-themesw', className)}
      data-mode={mode ?? undefined}
      data-ready={mode !== null || undefined}
      style={{ '--i': index } as CSSProperties}
    >
      <span className="sk-themesw__knob" aria-hidden>
        {MODES.map(({ mode: m, Icon }) => (
          <Icon key={m} size={15} className="sk-themesw__k" data-for={m} />
        ))}
      </span>
      {MODES.map(({ mode: m, label, Icon }, i) => {
        const checked = mode === m;
        return (
          <button
            key={m}
            ref={(el) => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked || (mode === null && i === 0) ? 0 : -1}
            disabled={mode === null}
            className="sk-themesw__opt"
            onClick={() => choose(m)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <Icon size={15} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
