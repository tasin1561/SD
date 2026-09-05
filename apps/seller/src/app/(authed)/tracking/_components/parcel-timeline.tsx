'use client';

import type { ReactElement } from 'react';
import { ShipmentStatusBadge } from '@skydrop/ui/components';
import type { ShipmentStatus } from '@skydrop/db';
import type { TrackedShipmentDetail } from '@/lib/api-hooks';

/**
 * One parcel's story, newest first.
 *
 * Ordered by the SCAN time, not when we received it (TRK-3) — a scan
 * that reached us late still happened when it happened, and putting it
 * at the end would make the parcel look like it went backwards.
 *
 * Failed attempts are shown WITH their reason. The public tracking page
 * deliberately hides those, because anyone with an AWB can read it; this
 * is the seller's own parcel, and "why did it fail" is the whole
 * question they came to ask.
 */
export function ParcelTimeline({
  parcel,
}: {
  readonly parcel: TrackedShipmentDetail;
}): ReactElement {
  const attemptsByTime = new Map(
    parcel.attempts.map((a) => [new Date(a.attemptedAt).toISOString().slice(0, 16), a]),
  );

  if (parcel.events.length === 0) {
    return (
      <p className="text-text-muted py-3 text-sm">
        No scans yet. The courier has the parcel but has not reported on it — the first scan usually
        appears within a day of pickup.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {parcel.events.map((e) => {
        const attempt = attemptsByTime.get(new Date(e.eventAt).toISOString().slice(0, 16));
        return (
          <li key={e.id} className="flex gap-3">
            <div className="flex flex-col items-center pt-1">
              <span className="bg-accent-fill h-2 w-2 shrink-0 rounded-full" />
              <span className="bg-border mt-1 w-px flex-1" />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <ShipmentStatusBadge status={e.status as ShipmentStatus} />
                <span className="text-text-faint text-xs">
                  {new Date(e.eventAt).toLocaleString()}
                </span>
                {e.source === 'MANUAL_ENTRY' && (
                  <span className="text-text-faint text-xs">· entered by our team</span>
                )}
              </div>
              {e.description !== null && (
                <p className="text-text-body mt-0.5 text-sm">{e.description}</p>
              )}
              {e.location !== null && <p className="text-text-faint text-xs">{e.location}</p>}
              {attempt !== undefined && attempt.outcome !== 'DELIVERED' && (
                <div className="border-[var(--color-warning-ring)] bg-[var(--color-warning-tint)] text-text-body mt-1 rounded-md border px-2 py-1.5 text-xs">
                  <div>
                    Attempt {attempt.attemptNumber} —{' '}
                    {humanise(attempt.failureReason ?? attempt.outcome)}
                  </div>
                  {attempt.failureNotes !== null && attempt.failureNotes !== '' && (
                    <div className="text-text-muted mt-0.5">{attempt.failureNotes}</div>
                  )}
                  {attempt.nextAttemptScheduledAt !== null && (
                    <div className="text-text-muted mt-0.5">
                      Next attempt {new Date(attempt.nextAttemptScheduledAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** CUSTOMER_PHONE_UNREACHABLE → "Customer phone unreachable". */
export function humanise(v: string): string {
  return v
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
