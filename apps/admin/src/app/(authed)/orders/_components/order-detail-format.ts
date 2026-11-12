/** Date formats the order detail uses. The ladder's own format, unchanged. */
export function fmt(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** An estimated date carries no time. */
export function fmtDate(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "15 Nov" — for the one-row header, where the year is noise. */
export function fmtDay(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "12 Nov, 4:40 pm" — a row in the activity list; the full stamp goes in `title`. */
export function fmtRowTime(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The page's original footnote format, now the header tooltip. */
export function fmtStamp(at: string): string {
  return new Date(at).toISOString().replace('T', ' ').slice(0, 16);
}
