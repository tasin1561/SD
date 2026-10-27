import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  langInitScript,
  type Locale,
} from '@skydrop/ui/app/i18n';
import { LanguageSwitch, LocaleProvider } from '@skydrop/ui/app/i18n-client';
import { useT } from '@/i18n/client';

/*
  The mechanism end to end, minus the network: the provider, the switch, the
  cookie + localStorage pair the server renders from, <html lang>, and the
  pre-hydration script. Server components cannot be rendered here — what makes
  them follow is `router.refresh()` after the cookie is written, which is what
  the `onLocaleChange` callback below stands in for.
*/

function Probe(): React.ReactElement {
  const t = useT();
  return (
    <>
      <h1>{t('nav.orders')}</h1>
      <p data-testid="status">{t('orders.prepaid')}</p>
    </>
  );
}

function mount(initial: Locale, onLocaleChange?: (l: Locale) => void): void {
  render(
    <LocaleProvider initialLocale={initial} onLocaleChange={onLocaleChange}>
      <LanguageSwitch />
      <Probe />
    </LocaleProvider>,
  );
}

function cookieValue(): string | undefined {
  return (
    document.cookie
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${LOCALE_COOKIE_NAME}=`))
      ?.slice(LOCALE_COOKIE_NAME.length + 1) || undefined
  );
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0`;
  document.documentElement.setAttribute('lang', 'en');
});
afterEach(cleanup);

describe('language switch', () => {
  it('is English by default', () => {
    mount('en');
    expect(screen.getByRole('heading').textContent).toBe('Orders');
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('switches every translated string at once, with no reload, and persists the choice', () => {
    const onChange = vi.fn();
    mount('en', onChange);
    fireEvent.click(screen.getByRole('radio', { name: 'বাংলা' }));

    expect(screen.getByRole('heading').textContent).toBe('অর্ডার');
    expect(screen.getByTestId('status').textContent).toBe('প্রিপেইড');
    expect(document.documentElement.getAttribute('lang')).toBe('bn');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('bn');
    expect(cookieValue()).toBe('bn');
    // The server components follow via router.refresh(), which the app wires here.
    expect(onChange).toHaveBeenCalledWith('bn');

    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(screen.getByRole('heading').textContent).toBe('Orders');
    expect(cookieValue()).toBe('en');
  });

  it('catches the text up when localStorage remembers Bangla but the server rendered English', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'bn');
    const onChange = vi.fn();
    mount('en', onChange);
    expect(screen.getByRole('heading').textContent).toBe('অর্ডার');
    expect(cookieValue()).toBe('bn');
    expect(onChange).toHaveBeenCalledWith('bn');
  });

  it('ignores a junk stored value and stays English', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    mount('en');
    expect(screen.getByRole('heading').textContent).toBe('Orders');
  });

  it('follows a change made in another tab', () => {
    mount('en');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: LOCALE_STORAGE_KEY, newValue: 'bn' }),
      );
    });
    expect(screen.getByRole('heading').textContent).toBe('অর্ডার');
  });

  it('moves with the arrow keys like a radio group', () => {
    mount('en');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(screen.getByRole('heading').textContent).toBe('অর্ডার');
  });
});

describe('langInitScript', () => {
  it('repairs the cookie from localStorage and stamps lang before hydration', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'bn');
    new Function(langInitScript)();
    expect(document.documentElement.getAttribute('lang')).toBe('bn');
    expect(cookieValue()).toBe('bn');
  });

  it('does nothing without a stored choice (English stays the default)', () => {
    new Function(langInitScript)();
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(cookieValue()).toBeUndefined();
  });

  it('ignores an unsupported stored value', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'hi');
    new Function(langInitScript)();
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });
});
