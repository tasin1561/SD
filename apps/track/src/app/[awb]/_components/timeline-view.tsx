import type { ReactElement } from 'react';
import type { PublicTrackingTimelineEvent } from '@/lib/types';
import { type Locale, statusKey, t } from '@/lib/i18n';

/**
 * Scan history as an event log — toned nodes on a vertical rail, newest
 * first (API order preserved).
 *
 * ── STATUS IS NEVER COLOUR ALONE ─────────────────────────────────────
 * Every row carries its label, and three things additionally carry SHAPE,
 * because colour is the one channel a reader may not have:
 *
 *   terminal  a hollow ring plus an end-cap across the rail. The journey
 *             stopped here; the line should look like it stopped.
 *   alert     a ringed node — the NDR is the one exceptional state and
 *             the only one a customer may need to act on.
 *   strike    a struck label, for a parcel that is not coming.
 *
 * `terminal` is a FLAG on the status definition, not a hardcoded list.
 * There are FIVE terminal statuses, not the three that carry a distinct
 * marker — `lost` and `damaged` end the journey exactly as `delivered`
 * does, and a hand-written list is where that gets forgotten.
 *
 * `cancelled` earns its strike for a reason worth keeping: it sits one
 * lightness step from `processing` in the neutral family, and to a buyer
 * those two mean opposite things — "nothing has happened yet" versus
 * "this is not coming". Two greys and a label is not enough separation
 * for that, so it gets a terminus and a struck label as well.
 */

type Marker = 'dot' | 'ring' | 'alert';

interface StatusMeta {
  /** The tone token. Resolved per theme; never a literal here. */
  readonly tone: string;
  /** Does the journey stop here? Drives the rail's end-cap. */
  readonly terminal: boolean;
  readonly marker: Marker;
  readonly strike?: boolean;
}

const FALLBACK: StatusMeta = {
  tone: 'var(--fg-muted)',
  terminal: false,
  marker: 'dot',
};

const STATUS_META: Record<string, StatusMeta> = {
  // ── in progress ──
  processing: { tone: 'var(--tone-processing)', terminal: false, marker: 'dot' },
  dispatched: { tone: 'var(--tone-dispatched)', terminal: false, marker: 'dot' },
  in_transit: { tone: 'var(--tone-in-transit)', terminal: false, marker: 'dot' },
  out_for_delivery: { tone: 'var(--tone-out-for-delivery)', terminal: false, marker: 'dot' },
  // ── attention: exceptional, and the only one that may need an action ──
  delivery_attempted: { tone: 'var(--tone-attempted)', terminal: false, marker: 'alert' },
  // ── the return chain: not terminal until the parcel is back ──
  return_initiated: { tone: 'var(--tone-returning)', terminal: false, marker: 'dot' },
  returning: { tone: 'var(--tone-returning)', terminal: false, marker: 'dot' },
  // ── terminal, all five ──
  delivered: { tone: 'var(--tone-delivered)', terminal: true, marker: 'ring' },
  returned: { tone: 'var(--tone-returned)', terminal: true, marker: 'ring' },
  lost: { tone: 'var(--tone-lost)', terminal: true, marker: 'ring' },
  damaged: { tone: 'var(--tone-lost)', terminal: true, marker: 'ring' },
  cancelled: { tone: 'var(--tone-cancelled)', terminal: true, marker: 'ring', strike: true },
};

export function TimelineView({
  events,
  locale,
}: {
  readonly events: ReadonlyArray<PublicTrackingTimelineEvent>;
  readonly locale: Locale;
}): ReactElement {
  if (events.length === 0) {
    return <div className="panel p-5 text-fg-muted text-sm">{t(locale, 'noScansYet')}</div>;
  }
  const bcp = locale === 'hi' ? 'hi-IN' : 'en-IN';
  return (
    <ol className="panel evt-rail list-none m-0 py-2 px-4 sm:px-5">
      {events.map((e, idx) => {
        const meta = STATUS_META[e.status] ?? FALLBACK;
        const latest = idx === 0;
        return (
          <li
            key={`${e.eventAt}-${idx}`}
            className="evt-rise relative flex items-start gap-4 py-3.5 pl-1"
            style={{ animationDelay: `${240 + Math.min(idx, 8) * 70}ms` }}
          >
            {/* The rail's terminus. Drawn above the node, so the line
                reads as ending rather than as running off the top. */}
            {meta.terminal && (
              <span aria-hidden className="evt-cap" style={{ background: meta.tone }} />
            )}
            <span
              aria-hidden
              className={[
                'evt-node relative z-10 mt-1.5 shrink-0 rounded-full',
                meta.marker === 'dot' ? 'evt-node-dot' : '',
                meta.marker === 'ring' ? 'evt-node-ring' : '',
                meta.marker === 'alert' ? 'evt-node-alert' : '',
                latest ? 'status-dot' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                // A ring is drawn with the tone as its border and the card
                // as its fill, so the shape survives with colour removed.
                ...(meta.marker === 'ring'
                  ? { borderColor: meta.tone, background: 'var(--surface-2)' }
                  : { background: meta.tone }),
                ...(meta.marker === 'alert'
                  ? { boxShadow: `0 0 0 3px var(--surface-2), 0 0 0 4px ${meta.tone}` }
                  : {}),
                ...(latest && meta.marker !== 'alert'
                  ? { filter: `drop-shadow(0 0 6px ${meta.tone})` }
                  : {}),
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span
                  className={[
                    'text-sm font-medium',
                    latest ? '' : 'text-fg-strong',
                    meta.strike ? 'line-through decoration-2' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={latest ? { color: meta.tone } : undefined}
                >
                  {t(locale, statusKey(e.status))}
                </span>
                <span className="font-mono text-[11px] text-fg-muted">
                  {new Date(e.eventAt).toLocaleString(bcp)}
                </span>
              </div>
              {e.description && <div className="text-fg-body text-xs mt-0.5">{e.description}</div>}
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
