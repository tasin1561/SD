import type { ReactElement } from 'react';
import type { PublicTrackingTimelineEvent } from '@/lib/types';
import { type Locale, statusKey, t } from '@/lib/i18n';

/**
 * Scan history as a console event log — mono timestamps, toned nodes
 * on a vertical rail, newest first (API order preserved).
 */

const STATUS_DOT: Record<string, string> = {
  delivered: 'var(--green)',
  out_for_delivery: 'var(--sky)',
  in_transit: 'var(--sky)',
  dispatched: 'var(--sky)',
  delivery_attempted: 'var(--saffron)',
  processing: 'var(--fg-muted)',
  return_initiated: 'var(--fg-muted)',
  returning: 'var(--fg-muted)',
  returned: 'var(--fg-muted)',
  lost: 'var(--red)',
  damaged: 'var(--red)',
  cancelled: 'var(--fg-muted)',
};

export function TimelineView({
  events,
  locale,
}: {
  readonly events: ReadonlyArray<PublicTrackingTimelineEvent>;
  readonly locale: Locale;
}): ReactElement {
  if (events.length === 0) {
    return (
      <div className="panel p-5 text-fg-muted text-sm">
        {t(locale, 'noScansYet')}
      </div>
    );
  }
  const bcp = locale === 'hi' ? 'hi-IN' : 'en-IN';
  return (
    <ol className="panel evt-rail list-none m-0 py-2 px-4 sm:px-5">
      {events.map((e, idx) => {
        const tone = STATUS_DOT[e.status] ?? 'var(--fg-muted)';
        const latest = idx === 0;
        return (
          <li
            key={`${e.eventAt}-${idx}`}
            className="evt-rise relative flex items-start gap-4 py-3.5 pl-1"
            style={{ animationDelay: `${240 + Math.min(idx, 8) * 70}ms` }}
          >
            <span
              aria-hidden
              className={`relative z-10 mt-1.5 h-[7px] w-[7px] rounded-full shrink-0 ${latest ? 'status-dot' : ''}`}
              style={{
                background: tone,
                boxShadow: latest ? `0 0 10px ${tone}` : undefined,
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span
                  className={`text-sm font-medium ${latest ? '' : 'text-fg-strong'}`}
                  style={latest ? { color: tone } : undefined}
                >
                  {t(locale, statusKey(e.status))}
                </span>
                <span className="font-mono text-[11px] text-fg-muted">
                  {new Date(e.eventAt).toLocaleString(bcp)}
                </span>
              </div>
              {e.description && (
                <div className="text-fg-body text-xs mt-0.5">{e.description}</div>
              )}
              {e.locationCity && (
                <div className="telemetry text-fg-muted mt-1">{e.locationCity}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
