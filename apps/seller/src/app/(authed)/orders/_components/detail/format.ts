import type { Locale } from '@skydrop/ui/app/i18n';
import { dateTag } from '@/i18n/format';

/**
 * ONE local date format for the whole order page (footnote, header facts,
 * tracker, call cards, history): "Today, 4:19 pm", "Yesterday, 4:19 pm",
 * else "12 Nov, 4:19 pm" (the year only when it is not this year). The
 * browser's own time zone, never UTC: a seller reads these against their
 * own clock.
 */
export interface DayWords {
  readonly today: string;
  readonly yesterday: string;
}

const startOfDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function fmtWhen(
  iso: string | null,
  locale: Locale,
  words: DayWords,
  now: Date = new Date(),
): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString(dateTag(locale, 'en-IN'), {
    hour: 'numeric',
    minute: '2-digit',
  });
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `${words.today}, ${time}`;
  if (days === 1) return `${words.yesterday}, ${time}`;
  const date = d.toLocaleDateString(dateTag(locale, 'en-IN'), {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
  });
  return `${date}, ${time}`;
}

/** The full stamp for a tooltip: "12 Nov 2026, 4:19:07 pm". */
export function fmtFull(iso: string | null, locale: Locale): string {
  if (iso === null) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(dateTag(locale, 'en-IN'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** A date with no time, for an estimate: "15 Nov 2026". */
export function fmtDay(iso: string | null, locale: Locale): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString(dateTag(locale, 'en-IN'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
