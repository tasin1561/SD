'use client';

import type { ReactElement } from 'react';
import { useLocale } from '@/i18n/client';
import { formatDate, formatDateTime } from '@/i18n/format';

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
