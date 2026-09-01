'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  Ident,
  Money,
  PageHeader,
  SkeletonRows,
} from '@skydrop/ui/components';
import { useMyNsaOrders } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * THE SELLER'S side of the NSA worklist.
 *
 * ── A DIFFERENT PAGE FROM OURS, ON PURPOSE ───────────────────────────
 * Same flag, different job. Ours is a queue to work through — every
 * seller's parcels, sorted worst-first, with a record of who is already
 * ringing which courier. This one answers one question for one person:
 * "is anything of mine stuck, and is somebody dealing with it."
 *
 * So it is cards rather than a table. A seller has a handful of these
 * at most, and the thing they need is the whole story of each one at a
 * glance — how many nights, where it is, whether we have picked it up —
 * not a dense grid they have to scan.
 *
 * ── WHY THERE IS NO BUTTON ───────────────────────────────────────────
 * The seller cannot make a courier deliver. Offering an action here
 * would be theatre. What they can do is raise a ticket, which the order
 * page already offers, so this links there rather than growing a second
 * way to do the same thing.
 */
export function NeedsAttentionIndex(): ReactElement {
  const list = useMyNsaOrders();
  const rows = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Needs attention"
        subtitle="Parcels that went out for delivery and were still out at the end of the day. The courier has not told us why, so we ask them."
      />

      {list.isLoading ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : list.isError ? (
        <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing of yours is stuck"
          description="Every parcel out for delivery has either arrived or been scanned as a failed attempt. This page fills in the evening, so it is normally empty during the day."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.orderId}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/orders/${r.orderId}`}
                      className="text-accent hover:underline font-mono"
                    >
                      {r.orderNumber}
                    </Link>
                    <div className="text-text-body mt-1 text-sm">
                      {r.recipientName} · {r.recipientCity}
                    </div>
                    {r.awbNumber !== null && (
                      <div className="text-text-faint mt-0.5 text-xs">
                        <Ident value={r.awbNumber} /> · {r.courierCode}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {/* The number of nights, in words, because "3" on its
                        own does not say what it counts. */}
                    <div
                      className={
                        r.dayCount >= 3
                          ? 'text-[var(--color-critical)] text-sm font-medium'
                          : r.dayCount === 2
                            ? 'text-[var(--color-warning)] text-sm font-medium'
                            : 'text-text-bright text-sm font-medium'
                      }
                    >
                      {r.dayCount === 1 ? 'Out since yesterday' : `Out for ${r.dayCount} days`}
                    </div>
                    {r.codAmountInr !== null && (
                      <div className="text-text-faint mt-0.5 text-xs">
                        COD <Money amount={r.codAmountInr} currency="INR" convert={false} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-border mt-3 border-t pt-3 text-xs">
                  {r.acknowledgedAt === null ? (
                    // Said plainly rather than left blank: "nobody has
                    // picked this up yet" is the thing worth knowing, and
                    // an empty space reads as a page that failed to load.
                    <span className="text-text-muted">
                      We have flagged this and will chase the courier. Nobody has picked it up yet.
                    </span>
                  ) : (
                    <span className="text-text-body">
                      We are chasing this — picked up {new Date(r.acknowledgedAt).toLocaleString()}
                      {r.note !== null && <span className="text-text-muted"> · {r.note}</span>}
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
