'use client';

import { clsx } from 'clsx';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { THEME_STORAGE_KEY } from './theme-init';

/**
 * Dark / light switch for the admin and seller consoles.
 *
 * The light palette has been fully defined in `tokens.css` under
 * `[data-theme='light']` since M12 and was unreachable: nothing ever
 * set the attribute. This is the switch that makes it reachable.
 *
 * DARK REMAINS THE DEFAULT — a fresh browser with no stored choice
 * gets the dark console, matching the ops-floor decision. The toggle
 * pins an explicit choice; it does not follow the OS, because a staff
 * member whose laptop flips to light at sunset should not have their
 * console flip with it mid-shift.
 *
 * IT APPLIES TO EVERY TAB, not only the one it was clicked in — see the
 * `storage` listener below for why that was worth fixing.
 *
 * `apps/track` has its own copy against its own token names (it is the
 * customer-facing page and does not import `@skydrop/ui`); this one is
 * shared by the two consoles that do.
 */

type Theme = 'dark' | 'light';

export function ThemeToggle({ className }: { readonly className?: string }): ReactElement {
  // Null until mounted. The server cannot know the stored choice, so
  // rendering a sun or a moon during SSR would guarantee a hydration
  // mismatch on one of the two themes.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const pinned = document.documentElement.getAttribute('data-theme');
    setTheme(pinned === 'light' ? 'light' : 'dark');

    /*
      THE CHOICE IS THE PERSON'S, NOT THE TAB'S.

      `data-theme` lives on ONE document, so switching to light only
      changed the tab it was clicked in. Every other tab already open
      kept the theme it loaded with — and since a warehouse machine
      lives with the pack bench, the printing screen and an order open
      side by side, the ordinary experience was "I set it to light and
      after a while it was dark again": moving to a tab opened before
      the switch.

      The `storage` event fires in every OTHER document on this origin
      (never in the one that wrote it), which is exactly the shape
      needed: one write, every tab follows. A tab that is loaded LATER
      is already covered by the init script reading the same key.
    */
    function onStorage(e: StorageEvent): void {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next: Theme = e.newValue === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      setTheme(next);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function apply(next: Theme): void {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode, or storage disabled. The theme still applies for
      // this page; it just will not survive a reload.
    }
    setTheme(next);
  }

  const isDark = theme !== 'light';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      // Before mount the control is inert but still occupies its space,
      // so the top bar does not shift when it resolves.
      disabled={theme === null}
      onClick={() => apply(isDark ? 'light' : 'dark')}
      className={clsx(
        'border-border text-text-muted hover:border-border-strong hover:text-text-bright hover:bg-surface-hover inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border transition-colors',
        theme === null && 'opacity-0',
        className,
      )}
    >
      {isDark ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}
