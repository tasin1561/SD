import type { Locale } from '@skydrop/ui/app/i18n';

/**
 * Date formatting tags per UI language. Bangla uses `bn-BD-u-nu-latn`: Bangla
 * month names and word order, but Western Arabic numerals (0-9) — numerals
 * stay 0-9 in every language. English keeps `en-IN`, as before.
 */
export function dateLocaleTag(locale: Locale): string {
  return locale === 'bn' ? 'bn-BD-u-nu-latn' : 'en-IN';
}

/** `26 Oct 2026` in English; `26 অক্টো, 2026` in Bangla. */
export function formatDate(iso: string | number | Date, locale: Locale): string {
  return new Date(iso).toLocaleDateString(dateLocaleTag(locale), { dateStyle: 'medium' });
}

/** Date and time, same rule. */
export function formatDateTime(iso: string | number | Date, locale: Locale): string {
  return new Date(iso).toLocaleString(dateLocaleTag(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Some screens never named a locale and so showed the browser's own format.
 * English keeps that exactly (`undefined` = the browser's default); Bangla gets
 * the same Bangla-month, Western-numeral tag as everywhere else.
 */
export function formatDateBrowser(iso: string | number | Date, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === 'bn' ? dateLocaleTag(locale) : undefined);
}

/** Date and time, browser default in English — see `formatDateBrowser`. */
export function formatDateTimeBrowser(iso: string | number | Date, locale: Locale): string {
  return new Date(iso).toLocaleString(locale === 'bn' ? dateLocaleTag(locale) : undefined);
}
