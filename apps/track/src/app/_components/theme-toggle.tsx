'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';

type Theme = 'dark' | 'light';

function resolveInitial(): Theme {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Sun/moon toggle — persists to localStorage (`sd-theme`). */
export function ThemeToggle(): ReactElement | null {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(resolveInitial());
  }, []);

  const apply = (next: Theme): void => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('sd-theme', next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  };

  if (theme === null) {
    return (
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="inline-flex items-center justify-center w-9 h-9 rounded-lg opacity-0"
      >
        <Sun size={15} />
      </button>
    );
  }

  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      onClick={() => apply(isDark ? 'light' : 'dark')}
      // Named so the light theme can give it a surface. On black a
      // hairline is enough to read as a control; on a pale page it is not.
      data-slot="theme-toggle"
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line text-fg-muted hover:text-fg-strong hover:bg-surface-3 transition-colors"
    >
      {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
    </button>
  );
}
