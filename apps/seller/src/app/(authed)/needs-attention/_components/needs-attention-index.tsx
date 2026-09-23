'use client';

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { PhoneOff, Truck } from 'lucide-react';
import { Ident, Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { ListRow, ListRows, type ListRowSeverity } from '@skydrop/ui/app/list-row';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { OrderStatus } from '@skydrop/db';
import { useMyNsaOrders } from '@/lib/ops-hooks';
import { useOrdersList } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import './needs-attention.css';

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
    <div className="nat-page">
      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Selling' },
          { label: 'Needs attention' },
        ]}
        Link={Link}
        title="Needs attention"
        subtitle="Orders we could not confirm on the phone, and parcels that went out for delivery and never arrived."
        /*
          EVERY non-empty case gets a fact, or the row goes blank while
          the page below it is full.

          The first cut only had facts for "waiting on you" and "stuck
          with a courier", so an account whose single unconfirmed order
          had already been LET GO rendered an empty row above a page
          listing that order — which reads as a header that failed to
          load rather than as one with nothing to say.
        */
        meta={
          answered ? (
            <span className="nat-meta">
              {unconfirmed.length === 0 && rows.length === 0 ? (
                <Fact tone="good" dot>
                  Nothing needs you
                </Fact>
              ) : (
                <>
                  {waitingOnYou > 0 && (
                    <Fact tone="warn">{waitingOnYou} waiting on your decision</Fact>
                  )}
                  {letGo > 0 && <Fact dot>{letGo} let go after the last attempt</Fact>}
                  {rows.length > 0 && <Fact tone="bad">{rows.length} stuck with a courier</Fact>}
                </>
              )}
            </span>
          ) : undefined
        }
      />

      <div className="nat-kpis">
        {/* Counts roll once on mount and land on exactly the string they
            always showed (`String`, no digit grouping). */}
        {/* BOTH queries, not either: this figure is their sum, and
            showing it when only one has landed is a number that then
            changes under the reader. */}
        {answered ? (
          <KpiCard
            label="We could not reach the customer"
            icon={<PhoneOff size={14} />}
            value={unconfirmed.length}
            format={String}
            unit={unconfirmed.length === 0 ? undefined : 'orders'}
            tone={waitingOnYou > 0 ? 'pending' : 'neutral'}
            hint={
              unconfirmed.length === 0
                ? 'Every order our agents rang was answered.'
                : 'You know your customer better than we do.'
            }
            foot={
              unconfirmed.length > 0
                ? [
                    { label: 'Waiting on your decision', value: waitingOnYou },
                    { label: 'Already let go', value: letGo },
                  ]
                : undefined
            }
          />
        ) : (
          <KpiCard
            label="We could not reach the customer"
            icon={<PhoneOff size={14} />}
            figure={<span className="nat-faint">—</span>}
            tone={waitingOnYou > 0 ? 'pending' : 'neutral'}
            foot={
              unconfirmed.length > 0
                ? [
                    { label: 'Waiting on your decision', value: waitingOnYou },
                    { label: 'Already let go', value: letGo },
                  ]
                : undefined
            }
          />
        )}
        {list.data === undefined ? (
          <KpiCard
            label="Out for delivery, never arrived"
            icon={<Truck size={14} />}
            figure={<span className="nat-faint">—</span>}
            unit={rows.length === 0 ? undefined : 'parcels'}
            tone={overdue > 0 ? 'debit' : rows.length > 0 ? 'pending' : 'neutral'}
            hint={answered ? overdueHint(rows.length) : undefined}
          />
        ) : (
          <KpiCard
            label="Out for delivery, never arrived"
            icon={<Truck size={14} />}
            value={rows.length}
            format={String}
            unit={rows.length === 0 ? undefined : 'parcels'}
            tone={overdue > 0 ? 'debit' : rows.length > 0 ? 'pending' : 'neutral'}
            hint={answered ? overdueHint(rows.length) : undefined}
            foot={
              rows.length > 0 ? [{ label: 'Out three nights or more', value: overdue }] : undefined
            }
          />
        )}
      </div>

      {unconfirmed.length > 0 && (
        <section className="nat-section">
          {/* A SECTION TITLE IS A LABEL, NOT A SENTENCE. At 360 — the
              width most of these sellers are on — a long title wraps
              into the note beside it; the sentence belongs in the note. */}
          <SectionHeading
            title="Could not reach"
            note="Our agents rang and nobody answered. Open one to ask us to try again, or leave it."
          />
          <ListRows label="Orders we could not confirm">
            {unconfirmed.map((o) => {
              const waiting = o.status === OrderStatus.AWAITING_SELLER_DECISION;
              return (
                <ListRow
                  key={o.id}
                  href={`/orders/${o.id}`}
                  Link={Link}
                  severity={waiting ? 'high' : 'medium'}
                  icon={<PhoneOff size={16} />}
                  title={<span className="sk-ident">{o.orderNumber}</span>}
                  description={
                    <>
                      <span className="nat-line">
                        {o.recipientName}
                        <span className="nat-faint sk-ident"> · {o.recipientPhoneE164}</span>
                      </span>
                      <span className="nat-line nat-faint">
                        Placed {new Date(o.placedAt).toLocaleDateString('en-IN')}
                      </span>
                      <span className="nat-next">
                        <span className="nat-next__lead">Open the order</span> — from there you can
                        ask us to call again, or raise an issue.
                      </span>
                    </>
                  }
                  status={
                    <span className="nat-state" data-tone={waiting ? 'pending' : undefined}>
                      {waiting ? 'Waiting on your decision' : 'Let go after the last attempt'}
                    </span>
                  }
                  meta={
                    o.codAmountInr !== null ? (
                      <span className="nat-cod">
                        COD <Money amount={o.codAmountInr} currency="INR" convert={false} />
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </ListRows>
        </section>
      )}

      <section className="nat-section">
        <SectionHeading
          title="Overdue parcels"
          note="Out for delivery and still not arrived. We chase the courier; this says how far we have got."
        />
        {list.isLoading ? (
          <SkeletonRows rows={3} label="Loading overdue parcels…" />
        ) : list.isError ? (
          <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          unconfirmed.length > 0 ? (
            // The page is NOT empty — saying "nothing of yours is stuck"
            // directly under a list of orders that need them reads as a
            // page arguing with itself.
            <p className="nat-quiet">Nothing of yours is out for delivery and overdue.</p>
          ) : (
            <EmptyState
              tone="positive"
              title="Nothing of yours needs you"
              description="No order is waiting on a decision, and every parcel out for delivery has either arrived or been scanned as a failed attempt. This page fills in the evening, so it is normally empty during the day."
            />
          )
        ) : (
          <ListRows label="Overdue parcels">
            {rows.map((r) => (
              <ListRow
                key={r.orderId}
                href={`/orders/${r.orderId}`}
                Link={Link}
                severity={nightsSeverity(r.dayCount)}
                icon={<Truck size={16} />}
                title={<span className="sk-ident">{r.orderNumber}</span>}
                description={
                  <>
                    <span className="nat-line">
                      {r.recipientName}
                      <span className="nat-faint"> · {r.recipientCity}</span>
                    </span>
                    {r.awbNumber !== null && (
                      <span className="nat-line nat-faint">
                        <Ident value={r.awbNumber} /> · {r.courierCode}
                      </span>
                    )}
                    {r.acknowledgedAt === null ? (
                      // Said plainly rather than left blank: "nobody has
                      // picked this up yet" is the thing worth knowing,
                      // and an empty space reads as a page that failed
                      // to load.
                      <span className="nat-next">
                        We have flagged this and will chase the courier. Nobody has picked it up
                        yet.
                      </span>
                    ) : (
                      <span className="nat-next" data-picked="1">
                        We are chasing this — picked up{' '}
                        {new Date(r.acknowledgedAt).toLocaleString('en-IN')}
                        {r.note !== null && <span className="nat-faint"> · {r.note}</span>}
                      </span>
                    )}
                  </>
                }
                status={
                  // The number of nights, in words, because "3" on its
                  // own does not say what it counts.
                  <span
                    className="nat-state"
                    data-tone={
                      r.dayCount >= 3 ? 'critical' : r.dayCount === 2 ? 'pending' : undefined
                    }
                  >
                    {r.dayCount === 1 ? 'Out since yesterday' : `Out for ${r.dayCount} days`}
                  </span>
                }
                meta={
                  r.codAmountInr !== null ? (
                    <span className="nat-cod">
                      COD <Money amount={r.codAmountInr} currency="INR" convert={false} />
                    </span>
                  ) : undefined
                }
              />
            ))}
          </ListRows>
        )}
      </section>
    </div>
  );
}

/** The hint under the overdue tile — only said once all three have answered. */
function overdueHint(count: number): string {
  return count === 0
    ? 'This list fills in the evening, so it is normally empty during the day.'
    : 'We chase the courier on these. You do not have to.';
}

/**
 * How loud a stuck parcel's row is, by the nights it has been out. Three
 * nights is where our own worklist stops treating a parcel as "still
 * moving" — the same threshold the tile above counts.
 */
function nightsSeverity(dayCount: number): ListRowSeverity {
  if (dayCount >= 3) return 'critical';
  if (dayCount === 2) return 'high';
  return 'medium';
}

/** A standing fact under the page title — never an action. */
function Fact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: 'good' | 'warn' | 'bad' | undefined;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="nat-fact" data-tone={tone}>
      {dot && <span className="nat-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}
