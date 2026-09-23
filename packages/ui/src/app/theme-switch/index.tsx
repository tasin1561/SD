'use client';

import { clsx } from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  pinnedTheme,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  writeThemeCookie,
  type PinnedTheme,
} from '../../components/theme-init';
import { reducedMotion } from '../motion/motion';
import './theme-switch.css';

export type ThemeMode = 'system' | PinnedTheme;

const MODES: readonly { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'system', label: 'System', Icon: Monitor },
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
];

function clearThemeCookie(): void {
  try {
    document.cookie = `${THEME_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax${
      window.location.protocol === 'https:' ? '; Secure' : ''
    }`;
  } catch {
    // Cookies disabled: nothing was stored there either.
  }
}

/** Put a mode on <html>, localStorage and the cookie the server renders from. Never throws. */
function applyMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Storage blocked: the page still follows the OS now.
    }
    clearThemeCookie();
    return;
  }
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
    setMode(pinned ?? 'system');

    function onStorage(e: StorageEvent): void {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = pinnedTheme(e.newValue);
      if (next === undefined) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', next);
      setMode(next ?? 'system');
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
