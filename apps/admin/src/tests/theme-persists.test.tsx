import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  pinnedTheme,
  resolvedTheme,
  ThemeToggle,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
  themeCookieString,
  themeInitScript,
} from '@skydrop/ui/components';

function clearThemeCookie(): void {
  document.cookie = `${THEME_COOKIE_NAME}=; path=/; max-age=0`;
}

function themeCookie(): string | null {
  for (const part of document.cookie.split(';')) {
    const p = part.trim();
    // An expired cookie can linger as `sd-theme=` in happy-dom; empty
    // means "no cookie", exactly as the layout's pinnedTheme() reads it.
    if (p.startsWith(`${THEME_COOKIE_NAME}=`)) {
      const value = p.slice(THEME_COOKIE_NAME.length + 1);
      return value === '' ? null : value;
    }
  }
  return null;
}

/**
 * The theme is the PERSON's choice, and it has to survive two things:
 * a reload, and a second tab.
 *
 * The reported symptom was "after a while it goes back to dark". The
 * reload half works — verified against production — so the half that
 * did not was the second tab: `data-theme` lives on one document, so a
 * tab opened before the switch kept the theme it loaded with, and
 * moving to it reads exactly like the setting undoing itself. A
 * warehouse machine has the pack bench, the printing screen and an
 * order open at once, so this is the ordinary case rather than an edge.
 */
describe('the theme survives a reload and reaches every tab', () => {
  beforeEach(() => {
    localStorage.clear();
    clearThemeCookie();
    document.documentElement.removeAttribute('data-theme');
  });

  it('pins the choice and stores it', async () => {
    render(<ThemeToggle />);
    await userEvent.click(await screen.findByRole('switch'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('writes the cookie the server renders <html data-theme> from', async () => {
    // React 19 resets <html>'s attributes to its SERVER props when it
    // recovers from a hydration mismatch. The pin survives that only if
    // the server knows it, and the cookie is how it knows.
    render(<ThemeToggle />);
    await userEvent.click(await screen.findByRole('switch'));
    expect(themeCookie()).toBe('light');
  });

  it('the init script migrates an existing stored choice into the cookie', () => {
    // Everybody who picked a theme before the cookie existed: they must
    // not have to click again for the server to render it.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(themeCookie()).toBeNull();
    // eslint-disable-next-line no-eval
    eval(themeInitScript);
    expect(themeCookie()).toBe('light');
  });

  it('the init script corrects a cookie that disagrees with the stored choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.cookie = `${THEME_COOKIE_NAME}=dark; path=/`;
    // eslint-disable-next-line no-eval
    eval(themeInitScript);
    expect(themeCookie()).toBe('light');
  });

  it('the init script writes no cookie when nothing is pinned', () => {
    // eslint-disable-next-line no-eval
    eval(themeInitScript);
    expect(themeCookie()).toBeNull();
  });

  it('puts back a pin that a root re-render wiped from <html>', () => {
    // The production symptom exactly: localStorage says light, <html>
    // has lost the attribute (React regenerated the root after a
    // hydration mismatch). Mounting the toggle restores it.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('the layout helper reads only a real pin from the cookie', () => {
    expect(pinnedTheme('light')).toBe('light');
    expect(pinnedTheme('dark')).toBe('dark');
    // Anything else renders no attribute, so the CSS default (dark) wins.
    expect(pinnedTheme(undefined)).toBeUndefined();
    expect(pinnedTheme(null)).toBeUndefined();
    expect(pinnedTheme('')).toBeUndefined();
    expect(pinnedTheme('blue')).toBeUndefined();
  });

  it('the cookie is a year, the whole origin, Lax, and Secure only on https', () => {
    const secure = themeCookieString('light', true);
    expect(secure).toContain(`${THEME_COOKIE_NAME}=light`);
    expect(secure).toContain('path=/');
    expect(secure).toContain(`max-age=${60 * 60 * 24 * 365}`);
    expect(secure).toContain('SameSite=Lax');
    expect(secure).toContain('Secure');
    expect(secure).not.toContain('HttpOnly');
    expect(themeCookieString('dark', false)).not.toContain('Secure');
  });

  it('the init script restores a stored choice before hydration', () => {
    // The script is a STRING inlined into <head> — running it here is
    // the closest thing to a reload this suite can do, and it is the
    // step that makes a stored choice mean anything.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    // eslint-disable-next-line no-eval
    eval(themeInitScript);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('no stored choice stamps LIGHT — it used to leave the attribute unset', () => {
    /*
      AMENDED 2026-10-26 (owner). This asserted that an unchosen theme
      left `data-theme` absent so the dark `:root` won, which was the
      old locked decision. The decision changed: the product opens
      light everywhere, the switch has two positions instead of three,
      and nothing reads `prefers-color-scheme` any more.

      The attribute being ALWAYS present is the mechanism — it is what
      makes the dark default unreachable without rewriting a stylesheet,
      and `check-theme.mjs` requires those blocks to stay.
    */
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
    // eslint-disable-next-line no-eval
    eval(themeInitScript);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('follows a change made in another tab', () => {
    render(<ThemeToggle />);
    // What the browser fires in every OTHER document on this origin.
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'light' }),
      );
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores an unrelated storage key', () => {
    // Another feature writing to localStorage must not repaint the app.
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'x' }));
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('stops listening when it unmounts', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ThemeToggle />);
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
  });
});

/**
 * Light is what an unchosen theme means now (owner, 2026-10-26).
 *
 * It used to mean "ask the operating system", and the switch carried a
 * third position, System, which worked by CLEARING the pin — so "no
 * pin" and "follow the OS" were the same state. The owner's decision is
 * light everywhere and only two positions, which makes the absence of a
 * choice an answer rather than a question.
 *
 * These pin the two halves that have to agree. If the server rendered
 * nothing and the script stamped light, React 19's hydration-mismatch
 * recovery would reset <html> to the server's props and the console
 * would turn dark mid-session — the exact bug the cookie was added to
 * fix, arriving through a different door.
 */
describe('an unchosen theme is LIGHT, on both halves', () => {
  it('the server renders light when no cookie is pinned', () => {
    expect(resolvedTheme(undefined)).toBe('light');
    expect(resolvedTheme(null)).toBe('light');
    expect(resolvedTheme('')).toBe('light');
    // A value left over from the three-position switch is not a pin.
    expect(resolvedTheme('system')).toBe('light');
  });

  it('a real pin still wins, in both directions', () => {
    expect(resolvedTheme('dark')).toBe('dark');
    expect(resolvedTheme('light')).toBe('light');
  });

  it('the init script ALWAYS stamps data-theme, never leaves it unset', () => {
    // What makes the dark `:root` default unreachable without touching
    // a stylesheet — check-theme.mjs needs those blocks to stay.
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
    new Function(themeInitScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('the init script still honours a stored pin', () => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(themeInitScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
