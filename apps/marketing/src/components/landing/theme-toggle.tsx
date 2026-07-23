'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { cn } from '@/lib/cn';

type Theme = 'dark' | 'light';

function resolveInitial(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/**
 * Sun/moon toggle. Persists to localStorage under `sd-theme`.
 * Kept as a client component so hydration cost is tiny — no server render.
 *
 * A11y: role=switch, aria-checked matches current mode. Icon indicates
 * the target theme (sun icon when currently dark = "click to lighten").
 */
export function ThemeToggle({
  className,
}: { className?: string }): ReactElement | null {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(resolveInitial());
  }, []);

  const applyTheme = (next: Theme): void => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('sd-theme', next);
    } catch {
      /* localStorage may throw in private mode; no-op */
    }
    setTheme(next);
  };

  if (theme === null) {
    // Prevent hydration mismatch — render a stable placeholder w/ same size.
    return (
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className={cn('inline-flex items-center justify-center w-10 h-10 rounded-lg opacity-0', className)}
      >
        <Sun size={16} />
      </button>
    );
  }

  const isDark = theme === 'dark';
  const nextLabel = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={nextLabel}
      title={nextLabel}
      onClick={() => applyTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'inline-flex items-center justify-center w-10 h-10 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors',
        className,
      )}
    >
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
}
