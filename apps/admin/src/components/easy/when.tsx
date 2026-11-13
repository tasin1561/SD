'use client';

import type { ReactElement } from 'react';
import { useLocale } from '@/i18n/client';
import { dateLocaleTag, formatDate, formatDateTime } from '@/i18n/format';

/**
 * A date (or date and time) written in the chosen language.
 *
 * A drop-in for `new Date(x).toLocaleString('en-IN')` inside JSX, where the
 * language was fixed to English or left to the browser. It reads the locale
 * itself, so the component around it needs no extra plumbing.
 */
export function When({
  iso,
  time = false,
}: {
  readonly iso: string | number | Date;
  /** Show the time as well as the date. */
  readonly time?: boolean;
}): ReactElement {
  const locale = useLocale();
  return <>{time ? formatDateTime(iso, locale) : formatDate(iso, locale)}</>;
}

/**
 * The date language for a plain helper function that cannot call a hook
 * (`function when(iso) { return new Date(iso).toLocaleString(...) }`).
 *
 * It reads the language the page was served in, `<html lang>`, which the
 * root layout sets from the chosen language. On the server, and for any
 * value it does not recognise, it answers English (India), which is what
 * those helpers had hard-coded. Use it only for values fetched in the
 * browser; inside a component prefer `<When>` or `formatDate`.
 */
export function pageDateTag(): string {
  if (typeof document === 'undefined') return 'en-IN';
  const lang = document.documentElement.lang;
  return lang === 'bn' || lang === 'hi' ? dateLocaleTag(lang) : 'en-IN';
}
