import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle, THEME_STORAGE_KEY, themeInitScript } from '@skydrop/ui/components';

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
    document.documentElement.removeAttribute('data-theme');
  });

  it('pins the choice and stores it', async () => {
    render(<ThemeToggle />);
    await userEvent.click(await screen.findByRole('switch'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
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

  it('no stored choice leaves the attribute unset, so dark wins', () => {
    // eslint-disable-next-line no-eval
    eval(themeInitScript);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
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
