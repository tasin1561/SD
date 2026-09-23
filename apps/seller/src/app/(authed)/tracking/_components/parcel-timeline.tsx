'use client';

import type { ReactElement } from 'react';
import { shipmentStatusKind, statusLabel } from '@skydrop/ui/status';
import type { ShipmentStatus } from '@skydrop/db';
import {
  Timeline,
  type TimelineHeader,
  type TimelineStep,
  type TimelineTone,
} from '@skydrop/ui/app/timeline';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import type { TrackedShipmentDetail } from '@/lib/api-hooks';
import '../../orders/_components/orders.css';

/**
 * One parcel's story, as the u17 timeline — the same one the public
 * tracking page draws.
 *
 * Ordered by the SCAN time, not when we received it (TRK-3) — a scan
 * that reached us late still happened when it happened, and putting it
 * at the end would make the parcel look like it went backwards. The
 * API hands the scans newest first; the timeline reads top to bottom
 * towards where the parcel is NOW, so they are drawn oldest first with
 * the latest as the current step, and the earlier ones fold away on a
 * long journey so the latest is on screen without scrolling.
 *
 * Failed attempts are shown WITH their reason. The public tracking page
 * deliberately hides those, because anyone with an AWB can read it; this
 * is the seller's own parcel, and "why did it fail" is the whole
 * question they came to ask.
 */
export function ParcelTimeline({
  parcel,
  header,
}: {
  readonly parcel: TrackedShipmentDetail;
  readonly header?: TimelineHeader | undefined;
}): ReactElement {
  const attemptsByTime = new Map(
    parcel.attempts.map((a) => [new Date(a.attemptedAt).toISOString().slice(0, 16), a]),
  );

  if (parcel.events.length === 0) {
    return (
      <EmptyState
        bare
        title="No scans yet"
        description="The courier has the parcel but has not reported on it — the first scan usually appears within a day of pickup."
      />
    );
  }

  const newestFirst = parcel.events;
  const latestKind =
    newestFirst[0] === undefined
      ? null
      : shipmentStatusKind(newestFirst[0].status as ShipmentStatus);

  const steps: TimelineStep[] = [...newestFirst].reverse().map((e, i, all): TimelineStep => {
    const attempt = attemptsByTime.get(new Date(e.eventAt).toISOString().slice(0, 16));
    const kind = shipmentStatusKind(e.status as ShipmentStatus);
    const tone: TimelineTone =
      kind === 'failed' ? 'failed' : kind === 'rto' ? 'returning' : 'default';
    const last = i === all.length - 1;
    return {
      id: e.id,
      label: statusLabel(e.status as ShipmentStatus),
      // The latest scan is where the parcel is now — unless it has
      // arrived, when there is nothing left in progress.
      state: last && latestKind !== 'delivered' ? 'current' : 'done',
      tone,
      time: new Date(e.eventAt).toLocaleString(),
      ...(e.location !== null ? { location: e.location } : {}),
      description:
        e.description === null &&
        e.source !== 'MANUAL_ENTRY' &&
        (attempt === undefined || attempt.outcome === 'DELIVERED') ? undefined : (
          <>
            {e.description !== null && <span>{e.description}</span>}
            {e.source === 'MANUAL_ENTRY' && <span className="ord-sub">· entered by our team</span>}
            {attempt !== undefined && attempt.outcome !== 'DELIVERED' && (
              <span className="ord-attempt">
                <span>
                  Attempt {attempt.attemptNumber} —{' '}
                  {humanise(attempt.failureReason ?? attempt.outcome)}
                </span>
                {attempt.failureNotes !== null && attempt.failureNotes !== '' && (
                  <span className="ord-muted">{attempt.failureNotes}</span>
                )}
                {attempt.nextAttemptScheduledAt !== null && (
                  <span className="ord-muted">
                    Next attempt {new Date(attempt.nextAttemptScheduledAt).toLocaleString()}
                  </span>
                )}
              </span>
            )}
          </>
        ),
    };
  });

  return (
    <Timeline
      label="Parcel history"
      steps={steps}
      header={header}
      collapseEarlier={{
        keep: 5,
        showLabel: 'Show {n} earlier scans',
        hideLabel: 'Hide earlier scans',
      }}
    />
  );
}

/** CUSTOMER_PHONE_UNREACHABLE → "Customer phone unreachable". */
export function humanise(v: string): string {
  return v
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
