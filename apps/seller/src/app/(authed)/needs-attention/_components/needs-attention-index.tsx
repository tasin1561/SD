'use client';

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { PhoneOff, Truck } from 'lucide-react';
import {
  BandBody,
  Crumbs,
  EmptyState,
  ErrorNote,
  Ident,
  MetaChip,
  Money,
  PageHeader,
  SectionBand,
  SkeletonRows,
  Stat,
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
 * So it is ROWS rather than a dense grid of columns. A seller has a
 * handful of these at most, and the thing they need is the whole story
 * of each one at a glance — how many nights, where it is, whether we
 * have picked it up.
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
 * So this page answers "does anything of mine need ME" first, and "is
 * anything of mine stuck" second. Both lists link to the order, where
 * the actions already live — "Ask us to call again" for a rejection,
 * "Raise an issue" for anything else. No action is reimplemented here;
 * two ways to perform one write is how they come to disagree.
 *
 * ── WHAT THE TILES COUNT ────────────────────────────────────────────
 * Exactly the rows below them, and nothing else. There is no
 * needs-attention summary endpoint, and both lists are capped — the
 * order queries at 20 apiece — so the tiles are a count of what is on
 * the page, which is what "is anything of mine stuck" actually asks.
 * No SLA figure, no resolution rate: nothing measures either.
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
  const waitingOnYou = (awaiting.data?.items ?? []).length;
  /** Nobody ever answered, so the order was dropped — REJECTED_NDR. */
  const letGo = (rejected.data?.items ?? []).length;
  /**
   * ALL THREE have answered.
   *
   * Every count here starts at 0, so "Nothing needs you" and "Every
   * order our agents rang was answered" are both true of a page that
   * has simply not loaded yet — and this is the page a seller opens
   * precisely to find out whether something needs them. The claims wait
   * for their own evidence; the figures read "—" until then.
   */
  const answered = awaiting.isSuccess && rejected.isSuccess && list.isSuccess;
  // Three nights is where our own worklist stops treating a parcel as
  // "still moving". Said here so the tile matches the red figure on the
  // rows below rather than inventing a second threshold.
  const overdue = rows.filter((r) => r.dayCount >= 3).length;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Selling' },
              { label: 'Needs attention' },
            ]}
            Link={Link}
          />
        }
        title="Needs attention"
        subtitle="Orders we could not confirm on the phone, and parcels that went out for delivery and never arrived."
        /*
          EVERY non-empty case gets a chip, or the row goes blank while
          the page below it is full.

          The first cut only had chips for "waiting on you" and "stuck
          with a courier", so an account whose single unconfirmed order
          had already been LET GO rendered an empty chip row above a
          page listing that order — which reads as a header that failed
          to load rather than as one with nothing to say.
        */
        meta={
          answered ? (
            unconfirmed.length === 0 && rows.length === 0 ? (
              <MetaChip tone="good" dot>
                Nothing needs you
              </MetaChip>
            ) : (
              <>
                {waitingOnYou > 0 && (
                  <MetaChip tone="warn">{waitingOnYou} waiting on your decision</MetaChip>
                )}
                {letGo > 0 && <MetaChip dot>{letGo} let go after the last attempt</MetaChip>}
                {rows.length > 0 && (
                  <MetaChip tone="bad">{rows.length} stuck with a courier</MetaChip>
                )}
              </>
            )
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          label="We could not reach the customer"
          icon={<PhoneOff size={13} aria-hidden />}
          // BOTH queries, not either: this figure is their sum, and
          // showing it when only one has landed is a number that then
          // changes under the reader.
          value={answered ? unconfirmed.length : <span className="text-text-faint">—</span>}
          unit={!answered || unconfirmed.length === 0 ? undefined : 'orders'}
          tone={waitingOnYou > 0 ? 'warn' : 'neutral'}
          {...(answered
            ? {
                hint:
                  unconfirmed.length === 0
                    ? 'Every order our agents rang was answered.'
                    : 'You know your customer better than we do.',
              }
            : {})}
          {...(unconfirmed.length > 0
            ? {
                foot: [
                  { label: 'Waiting on your decision', value: waitingOnYou },
                  { label: 'Already let go', value: letGo },
                ],
              }
            : {})}
        />
        <Stat
          label="Out for delivery, never arrived"
          icon={<Truck size={13} aria-hidden />}
          value={list.data === undefined ? <span className="text-text-faint">—</span> : rows.length}
          unit={rows.length === 0 ? undefined : 'parcels'}
          tone={overdue > 0 ? 'bad' : rows.length > 0 ? 'warn' : 'neutral'}
          {...(answered
            ? {
                hint:
                  rows.length === 0
                    ? 'This list fills in the evening, so it is normally empty during the day.'
                    : 'We chase the courier on these. You do not have to.',
              }
            : {})}
          {...(rows.length > 0
            ? { foot: [{ label: 'Out three nights or more', value: overdue }] }
            : {})}
        />
      </div>

      {unconfirmed.length > 0 && (
        <div className="mb-4">
          {/* A BAND TITLE IS A LABEL, NOT A SENTENCE. It shares one row
              with the index and truncates, so at 360 — the width most of
              these sellers are on — "We could not reach this customer"
              rendered as "OUT FOR DELIVERY AND STILL NOT…". About twenty
              characters fit; the rest belongs in the note, which wraps. */}
          <SectionBand
            index="01"
            title="Could not reach"
            note="Our agents rang and nobody answered. Open one to ask us to try again, or leave it."
          />
          <BandBody flush>
            <ul className="divide-border divide-y">
              {unconfirmed.map((o) => (
                <li key={o.id} className="px-3 py-3">
                  <Row
                    left={
                      <>
                        <Link
                          href={`/orders/${o.id}`}
                          className="text-accent font-mono text-sm hover:underline"
                        >
                          {o.orderNumber}
                        </Link>
                        <div className="text-text-body mt-1 text-sm">
                          {o.recipientName}
                          <span className="text-text-faint font-mono">
                            {' '}
                            · {o.recipientPhoneE164}
                          </span>
                        </div>
                        <div className="text-text-faint mt-0.5 font-mono text-xs">
                          Placed {new Date(o.placedAt).toLocaleDateString('en-IN')}
                        </div>
                      </>
                    }
                    right={
                      <>
                        <div
                          className={
                            o.status === OrderStatus.AWAITING_SELLER_DECISION
                              ? 'text-[var(--status-pending-fg)] text-sm font-medium'
                              : 'text-text-bright text-sm font-medium'
                          }
                        >
                          {o.status === OrderStatus.AWAITING_SELLER_DECISION
                            ? 'Waiting on your decision'
                            : 'Let go after the last attempt'}
                        </div>
                        {o.codAmountInr !== null && (
                          <div className="text-text-faint mt-0.5 text-xs">
                            COD <Money amount={o.codAmountInr} currency="INR" convert={false} />
                          </div>
                        )}
                      </>
                    }
                  />
                  <p className="border-border mt-2.5 border-t pt-2 text-xs">
                    <Link href={`/orders/${o.id}`} className="text-accent hover:underline">
                      Open the order
                    </Link>
                    <span className="text-text-muted">
                      {' '}
                      — from there you can ask us to call again, or raise an issue.
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </BandBody>
        </div>
      )}

      <SectionBand
        index={unconfirmed.length > 0 ? '02' : '01'}
        title="Overdue parcels"
        note="Out for delivery and still not arrived. We chase the courier; this says how far we have got."
      />
      <BandBody flush={!list.isLoading && !list.isError && rows.length > 0}>
        {list.isLoading ? (
          <SkeletonRows rows={3} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          unconfirmed.length > 0 ? (
            // The page is NOT empty — saying "nothing of yours is stuck"
            // directly under a list of orders that need them reads as a
            // page arguing with itself.
            <p className="text-text-muted text-sm">
              Nothing of yours is out for delivery and overdue.
            </p>
          ) : (
            <EmptyState
              title="Nothing of yours needs you"
              description="No order is waiting on a decision, and every parcel out for delivery has either arrived or been scanned as a failed attempt. This page fills in the evening, so it is normally empty during the day."
              bare
            />
          )
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((r) => (
              <li key={r.orderId} className="px-3 py-3">
                <Row
                  left={
                    <>
                      <Link
                        href={`/orders/${r.orderId}`}
                        className="text-accent font-mono text-sm hover:underline"
                      >
                        {r.orderNumber}
                      </Link>
                      <div className="text-text-body mt-1 text-sm">
                        {r.recipientName}
                        <span className="text-text-faint"> · {r.recipientCity}</span>
                      </div>
                      {r.awbNumber !== null && (
                        <div className="text-text-faint mt-0.5 text-xs">
                          <Ident value={r.awbNumber} /> · {r.courierCode}
                        </div>
                      )}
                    </>
                  }
                  right={
                    <>
                      {/* The number of nights, in words, because "3" on its
                          own does not say what it counts. */}
                      <div
                        className={
                          r.dayCount >= 3
                            ? 'text-[var(--color-critical)] text-sm font-medium'
                            : r.dayCount === 2
                              ? 'text-[var(--status-pending-fg)] text-sm font-medium'
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
                    </>
                  }
                />
                <p className="border-border mt-2.5 border-t pt-2 text-xs">
                  {r.acknowledgedAt === null ? (
                    // Said plainly rather than left blank: "nobody has
                    // picked this up yet" is the thing worth knowing, and
                    // an empty space reads as a page that failed to load.
                    <span className="text-text-muted">
                      We have flagged this and will chase the courier. Nobody has picked it up yet.
                    </span>
                  ) : (
                    <span className="text-text-body">
                      We are chasing this — picked up{' '}
                      {new Date(r.acknowledgedAt).toLocaleString('en-IN')}
                      {r.note !== null && <span className="text-text-muted"> · {r.note}</span>}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </BandBody>
    </div>
  );
}

/**
 * One parcel or order, as two columns that stack on a phone.
 *
 * Shared between the two lists rather than written twice: they carry
 * different facts and the same shape, and the shape is what makes them
 * scannable as one page.
 */
function Row({
  left,
  right,
}: {
  readonly left: ReactNode;
  readonly right: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">{left}</div>
      <div className="min-w-0 sm:text-right">{right}</div>
    </div>
  );
}
