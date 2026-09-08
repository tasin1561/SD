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
import { OrderStatus } from '@skydrop/db';
import { useMyNsaOrders } from '@/lib/ops-hooks';
import { useOrdersList } from '@/lib/api-hooks';
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
 * ── WHY THE COURIER LIST HAS NO BUTTON ───────────────────────────────
 * The seller cannot make a courier deliver. Offering an action there
 * would be theatre. What they can do is raise a ticket, which the order
 * page already offers, so it links there rather than growing a second
 * way to do the same thing.
 *
 * ── AND WHY THE CALL LIST CAME FIRST (2026-09-08) ────────────────────
 * The page shipped covering only the courier half, which is the half a
 * seller can do LEAST about. An order the call centre could not confirm
 * after its attempts is the opposite: nobody but the seller can decide
 * what happens to it, and it was reaching them nowhere. It ended in
 * REJECTED_NDR, or paused at AWAITING_SELLER_DECISION and surfaced only
 * on `/holds` — a page called "Held stock", which is not where anybody
 * looks for "the customer never answered".
 *
 * So this page now answers "does anything of mine need ME" first, and
 * "is anything of mine stuck" second. Both lists link to the order,
 * where the actions already live — "Ask us to call again" for a
 * rejection, "Raise an issue" for anything else. No action is
 * reimplemented here; two ways to perform one write is how they come to
 * disagree.
 */
export function NeedsAttentionIndex(): ReactElement {
  const list = useMyNsaOrders();
  const rows = list.data ?? [];

  /*
    Two statuses, two queries — the list endpoint takes one status.

    AWAITING_SELLER_DECISION is the R5b pause: the call cap was reached
    and this seller asked to be consulted before the order is dropped.
    REJECTED_NDR is what happens when they did not — nobody ever
    answered, so the order was let go. Both are "we could not confirm
    this", which is one thing as far as the person reading is concerned.
  */
  const awaiting = useOrdersList({
    status: OrderStatus.AWAITING_SELLER_DECISION,
    pageSize: 20,
  });
  const rejected = useOrdersList({ status: OrderStatus.REJECTED_NDR, pageSize: 20 });
  const unconfirmed = [...(awaiting.data?.items ?? []), ...(rejected.data?.items ?? [])];

  return (
    <div>
      <PageHeader
        title="Needs attention"
        subtitle="Orders we could not confirm on the phone, and parcels that went out for delivery and never arrived."
      />

      {unconfirmed.length > 0 && (
        <section className="mb-6">
          <h2 className="text-text-bright mb-1 text-sm font-medium tracking-tight">
            We could not reach this customer
          </h2>
          <p className="text-text-muted mb-2 text-xs leading-relaxed">
            Our agents rang and nobody answered, so the order stopped here. You know your customer
            better than we do — open one to ask us to try again, or leave it.
          </p>
          <div className="space-y-3">
            {unconfirmed.map((o) => (
              <Card key={o.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/orders/${o.id}`}
                        className="text-accent font-mono hover:underline"
                      >
                        {o.orderNumber}
                      </Link>
                      <div className="text-text-body mt-1 text-sm">
                        {o.recipientName} · {o.recipientPhoneE164}
                      </div>
                      <div className="text-text-faint mt-0.5 text-xs">
                        Placed {new Date(o.placedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-text-bright text-sm font-medium">
                        {o.status === OrderStatus.AWAITING_SELLER_DECISION
                          ? 'Waiting on your decision'
                          : 'Let go after the last attempt'}
                      </div>
                      {o.codAmountInr !== null && (
                        <div className="text-text-faint mt-0.5 text-xs">
                          COD <Money amount={o.codAmountInr} currency="INR" convert={false} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="border-border mt-3 border-t pt-3 text-xs">
                    <Link href={`/orders/${o.id}`} className="text-accent hover:underline">
                      Open the order
                    </Link>
                    <span className="text-text-muted">
                      {' '}
                      — from there you can ask us to call again, or raise an issue.
                    </span>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      {unconfirmed.length > 0 && (
        <h2 className="text-text-bright mb-2 text-sm font-medium tracking-tight">
          Out for delivery and still not arrived
        </h2>
      )}

      {list.isLoading ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : list.isError ? (
        <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        unconfirmed.length > 0 ? (
          // The page is NOT empty — saying "nothing of yours is stuck"
          // directly under a list of orders that need them reads as a
          // page arguing with itself.
          <Card>
            <CardBody>
              <p className="text-text-muted text-sm">
                Nothing of yours is out for delivery and overdue.
              </p>
            </CardBody>
          </Card>
        ) : (
          <EmptyState
            title="Nothing of yours needs you"
            description="No order is waiting on a decision, and every parcel out for delivery has either arrived or been scanned as a failed attempt. This page fills in the evening, so it is normally empty during the day."
          />
        )
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
