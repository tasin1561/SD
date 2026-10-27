'use client';

import { clsx } from 'clsx';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_NATIVE_NAMES,
  LOCALE_STORAGE_KEY,
  LOCALES,
  localeDir,
  makeTranslator,
  writeLocaleCookie,
  type Catalog,
  type Locale,
  type Translate,
} from '../i18n';
import { UI_MESSAGES, type UiMessageKey } from '../i18n/ui-messages';
import './language-switch.css';

/**
 * The client half of the UI language: provider, hooks and the switch.
 * Constants, the cookie and the init script are in `../i18n` (server-safe).
 *
 * The default context is `en` with a no-op setter, so every shared
 * primitive that reads it renders exactly as before in an app that has not
 * mounted a provider — adopting the language is opt-in per app.
 */

interface LocaleState {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleState>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
});

/**
 * `initialLocale` is what the SERVER rendered (from the `sd-lang` cookie), so
 * the first client render matches the HTML. `onLocaleChange` is the app's
 * hook to re-render its SERVER components (`router.refresh()`): client
 * components switch instantly from state, server ones need the new cookie.
 * Kept a callback so this package stays free of `next/*`.
 */
export function LocaleProvider({
  initialLocale,
  onLocaleChange,
  children,
}: {
  initialLocale: Locale;
  onLocaleChange?: ((next: Locale) => void) | undefined;
  children: ReactNode;
}): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const apply = useCallback(
    (next: Locale, persist: boolean) => {
      setLocaleState(next);
      const root = document.documentElement;
      root.setAttribute('lang', next);
      root.setAttribute('dir', localeDir(next));
      if (persist) {
        try {
          localStorage.setItem(LOCALE_STORAGE_KEY, next);
        } catch {
          // Storage blocked: the cookie below still carries the choice.
        }
        writeLocaleCookie(next);
      }
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  const setLocale = useCallback((next: Locale) => apply(next, true), [apply]);

  // The server may have rendered the other language (cookie cleared or never
  // set while localStorage remembers a choice). localStorage is the truth —
  // the same rule as the theme — so catch the text up once, after mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(stored) && stored !== initialLocale) apply(stored, true);
    } catch {
      // Storage blocked: stay on what the server rendered.
    }
    // Mount-only on purpose: a later `initialLocale` change is a navigation
    // re-render carrying the cookie we just wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change made in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === LOCALE_STORAGE_KEY && isLocale(e.newValue)) apply(e.newValue, false);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [apply]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The language being shown. `en` outside a provider. */
export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocale(): (next: Locale) => void {
  return useContext(LocaleContext).setLocale;
}

/**
 * A translator over an app's own catalogues. Typed by the catalogue's keys,
 * so `t('typo')` fails to compile; `bn` must define every key `en` does.
 */
export function useTranslator<K extends string>(catalogs: {
  readonly en: Catalog<K>;
  readonly bn: Catalog<K>;
}): Translate<K> {
  const locale = useLocale();
  return useMemo(() => makeTranslator(catalogs[locale], catalogs.en), [catalogs, locale]);
}

/**
 * A sentence with live nodes in it — `Showing {range} of {total}` with the two
 * figures bold, `Ask {link} to fix it` with a real link. Translators move the
 * placeholders to wherever the grammar wants them; the nodes stay React nodes.
 * Pass the UNFORMATTED template (`t(key)` with no params leaves `{x}` intact).
 */
export function richMessage(
  template: string,
  nodes: Readonly<Record<string, ReactNode>>,
): ReactNode {
  return template
    .split(/\{(\w+)\}/)
    .map((part, i) =>
      i % 2 === 1 ? <Fragment key={i}>{nodes[part] ?? `{${part}}`}</Fragment> : part,
    );
}

/** The shared primitives' own words (Shell, Pagination, Dismiss, …). */
export function useUiT(): Translate<UiMessageKey> {
  return useTranslator(UI_MESSAGES);
}

/**
 * Two-position language switch: English | বাংলা. Each option is labelled in
 * its OWN language and never translated. A radiogroup, arrow keys move and
 * select, one tab stop — the same ARIA shape as ThemeSwitch.
 */
export function LanguageSwitch({ className }: { className?: string | undefined }): ReactElement {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useUiT();

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (dir === 0) return;
    e.preventDefault();
    const i = LOCALES.indexOf(locale);
    const next = LOCALES[(i + dir + LOCALES.length) % LOCALES.length];
    if (next) {
      setLocale(next);
      const el = e.currentTarget.querySelector<HTMLElement>(`[data-locale="${next}"]`);
      el?.focus();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('ui.language')}
      className={clsx('sk-langsw', className)}
      onKeyDown={onKeyDown}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === locale}
          tabIndex={l === locale ? 0 : -1}
          data-locale={l}
          lang={l}
          className="sk-langsw__opt"
          onClick={() => setLocale(l)}
        >
          {LOCALE_NATIVE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
