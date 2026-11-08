import type { Locale } from '@skydrop/ui/app/i18n';

/**
 * Date formatting tags per UI language. Bangla uses `bn-BD-u-nu-latn`: Bangla
 * month names and word order, but Western Arabic numerals (0-9) — numerals
 * stay 0-9 in every language. English keeps `en-IN`, as before.
 *
 * Hindi takes `hi-IN-u-nu-latn` for the same reason Bangla takes its
 * `-u-nu-latn`: without it the month reads in Devanagari AND the digits
 * become १२३, and a warehouse hand matching a date against a printed
 * manifest is matching glyphs, not reading prose.
 */
export function dateLocaleTag(locale: Locale): string {
  if (locale === 'bn') return 'bn-BD-u-nu-latn';
  if (locale === 'hi') return 'hi-IN-u-nu-latn';
  return 'en-IN';
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
