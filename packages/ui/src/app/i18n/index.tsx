/**
 * UI language (en | bn) — the server-safe half: constants, the cookie, the
 * pre-hydration script and the `{param}` formatter.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────
 * Same reason as `components/theme-init.ts`: it must NOT carry
 * `'use client'`. A root layout is a SERVER component, and every export of
 * a client module reaches it as a client reference, so `langInitScript`
 * would arrive as an object and `resolveLocale(...)` would not be
 * callable. The provider and the switch live in `../i18n-client`.
 *
 * ── THIS IS NOT `customers.preferredLanguage` ────────────────────────
 * That column (`en | hi`) is the language of the SMS/notification sent to
 * an INDIAN CUSTOMER. This is the language the person at the keyboard
 * reads the console in. Different reader, different axis, different
 * values. Nothing here may be written to or read from that column.
 *
 * ── HOW IT IS WIRED (same shape as the theme) ────────────────────────
 *  - choice lives in the `sd-lang` cookie (what the SERVER renders from)
 *    and localStorage `sd-lang` (what survives a cleared cookie);
 *  - the root layout renders `<html lang={locale} dir={localeDir(locale)}>`
 *    from the cookie. The server must carry it: on a hydration mismatch
 *    React 19 resets <html>'s attributes to the SERVER props, so a
 *    client-only `lang` would silently revert to English;
 *  - `langInitScript` runs before hydration (inline it WITH the CSP nonce,
 *    `x-nonce`), repairs the cookie from localStorage and stamps `lang`.
 *
 * English is the default: no cookie, no storage, an unknown value → `en`.
 */

export const LOCALES = ['en', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** localStorage key. Shared with the switch. */
export const LOCALE_STORAGE_KEY = 'sd-lang';
/** The cookie the root layouts read. Same name: it is the same choice. */
export const LOCALE_COOKIE_NAME = LOCALE_STORAGE_KEY;

/**
 * A language's name IN that language. Never translated — a person who
 * cannot read the current language must still be able to find their own.
 */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  en: 'English',
  bn: 'বাংলা',
};

const LOCALE_COOKIE_ATTRIBUTES = `; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;

/** Narrow any cookie/storage value to a Locale; anything else is English. */
export function resolveLocale(value: string | null | undefined): Locale {
  return value === 'bn' ? 'bn' : DEFAULT_LOCALE;
}

/** True only for a value that IS a supported locale (no defaulting). */
export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'en' || value === 'bn';
}

/** Both supported languages read left-to-right; kept as a function so a future RTL one is one edit. */
export function localeDir(_locale: Locale): 'ltr' | 'rtl' {
  return 'ltr';
}

/** The `document.cookie` assignment for a choice. */
export function localeCookieString(locale: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE_NAME}=${locale}${LOCALE_COOKIE_ATTRIBUTES}${secure ? '; Secure' : ''}`;
}

/** Writes the cookie. Browser-only; never throws. */
export function writeLocaleCookie(locale: Locale): void {
  try {
    document.cookie = localeCookieString(locale, window.location.protocol === 'https:');
  } catch {
    // Cookies disabled: the language still applies client-side; the server
    // just cannot render it, and localStorage covers the reload.
  }
}

/** A message catalogue: every key present, every value a string. */
export type Catalog<K extends string> = Readonly<Record<K, string>>;
export type MessageParams = Readonly<Record<string, string | number>>;
export type Translate<K extends string> = (key: K, params?: MessageParams) => string;

/** `Hello {name}` + `{ name: 'Rina' }`. An unknown placeholder is left as written. */
export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/**
 * A translator over one locale's catalogue. The English catalogue is the
 * fallback, so a key missing from `bn` shows English rather than a raw key
 * (the types make a missing key a compile error; this is the runtime net).
 */
export function makeTranslator<K extends string>(
  catalog: Catalog<K>,
  fallback: Catalog<K>,
): Translate<K> {
  return (key, params) => formatMessage(catalog[key] ?? fallback[key] ?? String(key), params);
}

/**
 * Runs before hydration. Only a VALID stored choice is applied. It brings the
 * cookie into line with localStorage (the migration for anyone who picked a
 * language before the cookie existed, and the repair for a cleared cookie) and
 * stamps `lang` so assistive tech and font selection are right from first paint.
 * The provider then reconciles the TEXT on mount if the server rendered the
 * other language.
 */
export const langInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${LOCALE_STORAGE_KEY}');
    if (stored === 'en' || stored === 'bn') {
      document.documentElement.setAttribute('lang', stored);
      var current = null;
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/^\\s+/, '');
        if (part.indexOf('${LOCALE_COOKIE_NAME}=') === 0) {
          current = part.slice(${LOCALE_COOKIE_NAME.length + 1});
        }
      }
      if (current !== stored) {
        document.cookie = '${LOCALE_COOKIE_NAME}=' + stored + '${LOCALE_COOKIE_ATTRIBUTES}' +
          (location.protocol === 'https:' ? '; Secure' : '');
      }
    }
  } catch (_) {}
})();
`;

/** The shared primitives' own words, both languages (see `./ui-messages`). */
export { UI_MESSAGES, type UiMessageKey } from './ui-messages';
