import type { ReactElement } from 'react';
import type { PublicTrackingTimelineEvent } from '@/lib/types';

const STATUS_DOT: Record<string, string> = {
  delivered: 'var(--color-accent)',
  out_for_delivery: 'var(--color-accent)',
  in_transit: 'var(--color-text-body)',
  dispatched: 'var(--color-text-body)',
  delivery_attempted: 'var(--color-critical)',
  processing: 'var(--color-text-faint)',
  return_initiated: 'var(--color-text-muted)',
  returning: 'var(--color-text-muted)',
  returned: 'var(--color-text-muted)',
  lost: 'var(--color-critical)',
  damaged: 'var(--color-critical)',
  cancelled: 'var(--color-text-faint)',
};

const STATUS_LABEL: Record<string, string> = {
  processing: 'Processing',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivery_attempted: 'Delivery attempted',
  delivered: 'Delivered',
  return_initiated: 'Return initiated',
  returning: 'Returning',
  returned: 'Returned',
  lost: 'Lost',
  damaged: 'Damaged',
  cancelled: 'Cancelled',
};

export function TimelineView({
  events,
}: {
  readonly events: ReadonlyArray<PublicTrackingTimelineEvent>;
}): ReactElement {
  if (events.length === 0) {
    return (
      <div className="rounded-[7px] border border-border bg-surface p-4 text-text-muted text-sm">
        No scans yet. Once the courier picks up the parcel, scan events
        will appear here.
      </div>
    );
  }
  return (
    <ol className="rounded-[7px] border border-border bg-surface divide-y divide-border">
      {events.map((e, idx) => (
        <li key={`${e.eventAt}-${idx}`} className="flex items-start gap-3 px-4 py-3">
          <div
            className="w-2 h-2 rounded-full mt-1.5 shrink-0"
            style={{ background: STATUS_DOT[e.status] ?? 'var(--color-text-faint)' }}
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <div className="text-text-bright text-sm font-medium">
              {STATUS_LABEL[e.status] ?? e.status}
            </div>
            {e.description && (
              <div className="text-text-muted text-xs mt-0.5">{e.description}</div>
            )}
            <div className="text-text-faint text-xs mt-1">
              {new Date(e.eventAt).toLocaleString()}
              {e.locationCity ? ` · ${e.locationCity}` : ''}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
