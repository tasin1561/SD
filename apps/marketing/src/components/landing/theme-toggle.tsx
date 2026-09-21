'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { PAGE_BG, type ThemeName } from '@/lib/theme-colors';

function resolveInitial(): ThemeName {
  if (typeof document === 'undefined') return 'dark';
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(next: ThemeName): void {
  document.documentElement.setAttribute('data-theme', next);
  // Keep the browser chrome in step with the page (see theme-init.ts).
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', PAGE_BG[next]));
  try {
    localStorage.setItem('sd-theme', next);
  } catch {
    /* localStorage may throw in private mode; no-op */
  }
}

/**
 * Sun/moon toggle. Persists to localStorage under `sd-theme`.
 * Kept as a client component so hydration cost is tiny — no server render.
 *
 * The switch is wrapped in a View Transition where the browser has one,
 * so the whole page cross-fades (180 ms, `::view-transition-*` in
 * globals.css) instead of every surface snapping at once. Skipped under
 * reduced motion — the fallback is the plain attribute write.
 *
 * A11y: role=switch, aria-checked matches current mode. Icon indicates
 * the target theme (sun icon when currently dark = "click to lighten").
 */
export function ThemeToggle({ className }: { className?: string }): ReactElement | null {
  const [theme, setTheme] = useState<ThemeName | null>(null);

  useEffect(() => {
    setTheme(resolveInitial());
  }, []);

  const applyTheme = (next: ThemeName): void => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (!reduced && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => apply(next));
    } else {
      apply(next);
    }
    setTheme(next);
  };

  if (theme === null) {
    // Placeholder keeps layout stable before hydration resolves.
    return <span className={cn('inline-block h-11 w-11', className)} aria-hidden="true" />;
  }

  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => applyTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg-strong',
        className,
      )}
    >
      {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
