'use client';

import type { ReactElement } from 'react';
import { Check } from 'lucide-react';
import { Card, CardBody, CardHeader } from './card';

export type MilestoneOwner = 'SKYDROP' | 'COURIER';
export type MilestoneState = 'DONE' | 'CURRENT' | 'PENDING' | 'SKIPPED';

export interface JourneyMilestoneView {
  readonly key: string;
  readonly label: string;
  readonly owner: MilestoneOwner;
  readonly at: string | null;
  readonly state: MilestoneState;
  readonly detail: string | null;
  readonly estimated: boolean;
}

export interface JourneyEntryView {
  readonly at: string;
  readonly owner: MilestoneOwner;
  readonly title: string;
  readonly detail: string | null;
  readonly location: string | null;
  readonly nslCode: string | null;
  readonly rawStatus: string | null;
  readonly attempt: {
    readonly number: number;
    readonly reason: string | null;
    readonly notes: string | null;
    readonly nextAttemptAt: string | null;
    readonly agentName: string | null;
    readonly agentPhone: string | null;
    readonly contactedCustomer: boolean | null;
    readonly customerResponse: string | null;
    readonly nsl: {
      readonly code: string;
      readonly plain: string | null;
      readonly reAttemptable: boolean;
      readonly reschedulable: boolean;
    } | null;
  } | null;
}

export interface JourneyParcelView {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly courierCode: string;
  /**
   * WHICH of our accounts with that courier carried it (CACC-1). One
   * courier can be several accounts, and every later question about
   * this parcel is answered from that account.
   */
  readonly courierAccountLabel?: string | null;
  readonly status: string;
  readonly declaredWeightGrams: number | null;
  readonly chargeableWeightGrams: number | null;
  readonly dimensionsCm: string | null;
  readonly expectedDeliveryAt: string | null;
  readonly collectableAmountInr: string | null;
  readonly courierCollectableInr: string | null;
  readonly paymentMode: string;
  readonly courierPickedUpAt: string | null;
  readonly courierSortCode: string | null;
  readonly courierStatusLine: string | null;
  readonly courierStatusLocation: string | null;
}

function fmt(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDate(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The stage ladder — every step of the parcel's life, ours and theirs.
 *
 * ── WHY OWNERSHIP IS ON THE FACE OF IT ───────────────────────────────
 * A seller chasing a late parcel needs to know WHO to chase, and the
 * answer is nearly always readable from where the ladder stopped: stuck
 * before "Handed to courier" is ours to fix, stuck after it is the
 * courier's. Labelling each rung removes the question rather than
 * leaving it to be inferred from the wording.
 *
 * SKIPPED renders differently from PENDING on purpose. A rung a later
 * one has already overtaken did not happen and never will — an order
 * confirmed by an admin override was never phoned — and showing it as
 * still-to-come would mean the ladder never completes.
 */
export function JourneyLadder({
  milestones,
}: {
  readonly milestones: readonly JourneyMilestoneView[];
}): ReactElement {
  return (
    <ol className="flex flex-col">
      {milestones.map((m, i) => {
        const last = i === milestones.length - 1;
        const done = m.state === 'DONE' || m.state === 'CURRENT';
        return (
          <li key={m.key} className="flex gap-3">
            {/*
              Rail: the marker plus the line to the next rung.

              A DONE step carries a tick rather than a dot. The dots all
              looked the same at a glance, so "how far has this got" was
              a question you answered by reading nine labels; a column
              of ticks stopping at a hollow ring answers it in one look.
            */}
            <div className="flex flex-col items-center" aria-hidden>
              {m.state === 'DONE' ? (
                <span className="bg-accent-fill text-accent-fg mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                  <Check size={12} strokeWidth={3} />
                </span>
              ) : m.state === 'CURRENT' ? (
                <span className="bg-accent-fill ring-accent/25 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-4">
                  <span className="bg-accent-fg h-1.5 w-1.5 rounded-full" />
                </span>
              ) : (
                <span
                  className={[
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    m.state === 'SKIPPED'
                      ? 'border-border bg-surface-raised'
                      : 'border-border bg-transparent',
                  ].join(' ')}
                >
                  <span className="bg-border h-1.5 w-1.5 rounded-full" />
                </span>
              )}
              {!last && (
                <span
                  className={['w-px flex-1', done ? 'bg-accent-fill/50' : 'bg-border'].join(' ')}
                  style={{ minHeight: '1.25rem' }}
                />
              )}
            </div>

            {/*
              The CURRENT step sits in a tinted panel with an accent
              edge. Where a parcel has actually GOT TO is the one thing
              this list exists to say, and bolder text alone was not
              saying it — the reference comps make it a surface, and a
              surface is what the eye finds first.
            */}
            <div
              className={[
                'min-w-0 flex-1',
                last ? 'pb-0' : 'pb-4',
                m.state === 'CURRENT'
                  ? 'border-accent/40 bg-accent/5 -mt-0.5 mb-2 rounded-md border px-3 py-2'
                  : '',
              ].join(' ')}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={[
                    'text-sm',
                    m.state === 'CURRENT'
                      ? 'font-semibold'
                      : m.state === 'PENDING' || m.state === 'SKIPPED'
                        ? 'text-text-faint'
                        : 'font-medium',
                  ].join(' ')}
                >
                  {m.label}
                </span>
                <span className="text-text-faint text-[11px] tracking-wide uppercase">
                  {m.owner === 'SKYDROP' ? 'Skydrop' : 'Courier'}
                </span>
                {m.state === 'SKIPPED' && (
                  <span className="text-text-faint text-[11px]">not needed</span>
                )}
              </div>

              {m.at !== null && (
                <div className="text-text-muted mt-0.5 text-xs">
                  {m.estimated ? `Estimated ${fmtDate(m.at)}` : fmt(m.at)}
                </div>
              )}
              {m.detail !== null && (
                <div className="text-text-faint mt-0.5 text-xs">{m.detail}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What the courier says the parcel IS.
 *
 * The chargeable weight is shown NEXT TO the declared one whenever they
 * differ, because the gap is the whole story: the courier bills on
 * theirs, and a seller seeing only their own number cannot understand
 * the invoice. Identical values collapse to one line — a difference
 * highlighted only when it exists is a difference somebody notices.
 */
export function ParcelFacts({
  parcel,
  allParcelsHref,
}: {
  readonly parcel: JourneyParcelView;
  /** Where "all parcels" lives, when the host app has such a page. */
  readonly allParcelsHref?: string;
}): ReactElement {
  const declared = parcel.declaredWeightGrams;
  const charged = parcel.chargeableWeightGrams;
  const differs = declared !== null && charged !== null && declared !== charged;

  const rows: Array<{ label: string; value: ReactElement | string; hint?: string }> = [
    {
      label: 'Chargeable weight',
      value:
        charged === null ? (
          <span className="text-text-faint">Not yet weighed</span>
        ) : (
          <span className="tabular-nums">{charged} g</span>
        ),
      ...(differs ? { hint: `You declared ${String(declared)} g` } : {}),
    },
    {
      label: 'Dimensions',
      value: parcel.dimensionsCm ?? <span className="text-text-faint">—</span>,
    },
    {
      label: 'Expected delivery',
      value:
        parcel.expectedDeliveryAt === null ? (
          <span className="text-text-faint">Not stated yet</span>
        ) : (
          fmtDate(parcel.expectedDeliveryAt)
        ),
    },
    {
      label: 'Collectable amount',
      value:
        // PREPAID collects nothing, and that is a fact rather than a
        // missing value — an em-dash here reads as "we do not know".
        parcel.paymentMode !== 'COD' ? (
          <span className="text-text-faint">Nothing — prepaid</span>
        ) : parcel.collectableAmountInr === null ? (
          <span className="text-text-faint">—</span>
        ) : (
          <span className="tabular-nums">₹{parcel.collectableAmountInr}</span>
        ),
      ...(parcel.paymentMode === 'COD'
        ? {
            hint:
              // A DISAGREEMENT about money on a parcel already moving.
              // Silent, this arrives weeks later as a remittance that is
              // short; stated, it is a phone call today.
              parcel.courierCollectableInr !== null &&
              parcel.courierCollectableInr !== parcel.collectableAmountInr
                ? `The courier says ₹${parcel.courierCollectableInr} — this does not match`
                : 'What the courier collects at the door',
          }
        : {}),
    },
    {
      label: 'Collected by courier',
      value:
        parcel.courierPickedUpAt === null ? (
          <span className="text-text-faint">Not yet</span>
        ) : (
          fmt(parcel.courierPickedUpAt)
        ),
    },
    ...(parcel.courierStatusLine === null
      ? []
      : [
          {
            label: "Courier's own status",
            value: parcel.courierStatusLine,
            ...(parcel.courierStatusLocation === null
              ? {}
              : { hint: parcel.courierStatusLocation }),
          },
        ]),
    ...(parcel.courierSortCode === null
      ? []
      : [
          {
            // Opaque to us, and the first thing their support asks for.
            label: 'Routing code',
            value: <span className="font-mono text-xs">{parcel.courierSortCode}</span>,
          },
        ]),
  ];

  return (
    <>
      {/* The parcel's identity, above what it weighs. This used to be
          the header of a separate tracking panel whose body repeated
          the history below — the identity was the only part of it that
          was not already on the page. */}
      <div className="border-border mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
        <span className="font-mono text-sm">{parcel.awbNumber ?? parcel.shipmentNumber}</span>
        <span className="text-text-faint text-xs">
          {parcel.courierCode}
          {parcel.courierAccountLabel == null || parcel.courierAccountLabel === ''
            ? null
            : ` · ${parcel.courierAccountLabel}`}
        </span>
        {allParcelsHref !== undefined && (
          <a href={allParcelsHref} className="text-accent ml-auto text-xs hover:underline">
            All parcels →
          </a>
        )}
      </div>
      <dl className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-text-muted text-xs">{r.label}</dt>
            <dd className="text-right text-sm">
              {r.value}
              {r.hint !== undefined && (
                <span className="text-text-faint block text-[11px]">{r.hint}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * Our events and the courier's scans, as ONE story.
 *
 * Two panels showing the same parcel's life is a reconciliation
 * exercise for the reader. Each line is tagged with who did it, so the
 * merge stays legible rather than becoming an undifferentiated list.
 */
export function JourneyTimeline({
  entries,
  showCourierCodes = false,
}: {
  readonly entries: readonly JourneyEntryView[];
  /** Staff see the courier's own status code; sellers do not — it is
   *  vocabulary they never asked to learn. */
  readonly showCourierCodes?: boolean;
}): ReactElement {
  if (entries.length === 0) {
    return <p className="text-text-faint text-sm">Nothing has happened to this order yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-3">
          <span
            aria-hidden
            className={[
              'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
              // A FAILED ATTEMPT is marked as one. It was the same grey
              // or blue dot as "bag scanned at the hub", which is the
              // only kind of entry a seller is scanning this list to
              // find — colour here is the meaning, not decoration.
              e.attempt !== null
                ? 'bg-warning'
                : e.owner === 'COURIER'
                  ? 'bg-accent-fill'
                  : 'bg-text-faint',
            ].join(' ')}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={['text-sm font-medium', e.attempt !== null ? 'text-warning' : ''].join(
                  ' ',
                )}
              >
                {e.title}
              </span>
              <span className="text-text-faint text-[11px] tracking-wide uppercase">
                {e.owner === 'SKYDROP' ? 'Skydrop' : 'Courier'}
              </span>
              <span className="text-text-faint ml-auto text-xs whitespace-nowrap">{fmt(e.at)}</span>
            </div>
            {e.detail !== null && <div className="text-text-muted text-xs">{e.detail}</div>}
            {e.location !== null && <div className="text-text-faint text-xs">{e.location}</div>}
            {showCourierCodes && e.nslCode !== null && e.attempt === null && (
              <div className="text-text-faint mt-0.5 font-mono text-[11px]">{e.nslCode}</div>
            )}
            {e.attempt !== null && <AttemptDetail attempt={e.attempt} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Everything the courier told us about a failed delivery.
 *
 * ── WHY ALL OF IT, AND TO THE SELLER ─────────────────────────────────
 * Every field here was already captured on every failed delivery and
 * shown to nobody. The driver's name and number in particular: Delhivery
 * supplies them so the shipper can follow up, and a seller chasing a
 * failed COD parcel had them sitting in our database with no way to see
 * them.
 *
 * The NSL code is shown WITH its interpretation, and the interpretation
 * leads with what can be DONE — whether a re-attempt is even accepted on
 * this code — because that is the actionable half and the only half
 * Delhivery actually publishes. An unrecognised code prints as itself
 * rather than as a guess: telling a seller their customer refused the
 * parcel when the code meant the office was shut is worse than telling
 * them nothing, because they act on it.
 */
function AttemptDetail({
  attempt,
}: {
  readonly attempt: NonNullable<JourneyEntryView['attempt']>;
}): ReactElement {
  return (
    <div className="border-border bg-surface-raised mt-1.5 flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">Delivery attempt {attempt.number}</span>
        {attempt.reason !== null && (
          <span className="text-text-muted">{humanise(attempt.reason)}</span>
        )}
      </div>

      {attempt.notes !== null && <div className="text-text-muted">{attempt.notes}</div>}

      {attempt.contactedCustomer !== null && (
        <div className="text-text-muted">
          {attempt.contactedCustomer ? 'Reached the customer' : 'Could not reach the customer'}
          {attempt.customerResponse !== null && ` — “${attempt.customerResponse}”`}
        </div>
      )}

      {attempt.nextAttemptAt !== null && (
        <div className="text-text-muted">Next attempt {fmt(attempt.nextAttemptAt)}</div>
      )}

      {(attempt.agentName !== null || attempt.agentPhone !== null) && (
        <div className="text-text-muted">
          Driver {attempt.agentName ?? 'unnamed'}
          {attempt.agentPhone !== null && (
            <>
              {' · '}
              <a href={`tel:${attempt.agentPhone}`} className="text-accent hover:underline">
                {attempt.agentPhone}
              </a>
            </>
          )}
        </div>
      )}

      {attempt.nsl !== null && (
        <div className="text-text-faint">
          <span className="font-mono">{attempt.nsl.code}</span>
          {attempt.nsl.plain !== null ? (
            <> — {attempt.nsl.plain}</>
          ) : (
            <> — meaning not in our table</>
          )}
          {attempt.nsl.reAttemptable && ' · a re-attempt can be requested'}
          {attempt.nsl.reschedulable && ' · a pickup reschedule applies'}
        </div>
      )}
    </div>
  );
}

/** `CUSTOMER_UNAVAILABLE` → `Customer unavailable`. */
function humanise(v: string): string {
  const lower = v.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The three panels together, as both order pages use them. */
export function OrderJourneyPanels({
  milestones,
  parcels,
  entries,
  showCourierCodes = false,
  allParcelsHref,
}: {
  readonly milestones: readonly JourneyMilestoneView[];
  readonly parcels: readonly JourneyParcelView[];
  readonly entries: readonly JourneyEntryView[];
  readonly showCourierCodes?: boolean;
  readonly allParcelsHref?: string;
}): ReactElement {
  const parcel = parcels[parcels.length - 1] ?? null;
  return (
    <div className="flex flex-col gap-4">
      {/*
        Two up only when there IS a parcel. An order with none — not yet
        dispatched, or cancelled before it was — used to leave the
        tracker at half width with an empty half beside it, which reads
        as a panel that failed to load rather than one with nothing to
        show. Worse since the seller order page put this in a column.
      */}
      <div className={parcel === null ? 'grid gap-4' : 'grid gap-4 lg:grid-cols-[1fr_1fr]'}>
        <Card>
          <CardHeader title="Order tracker" />
          <CardBody>
            <JourneyLadder milestones={milestones} />
          </CardBody>
        </Card>
        {parcel !== null && (
          <Card>
            <CardHeader title="Parcel" />
            <CardBody>
              <ParcelFacts
                parcel={parcel}
                {...(allParcelsHref === undefined ? {} : { allParcelsHref })}
              />
            </CardBody>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader title="Full history" />
        <CardBody>
          <JourneyTimeline entries={entries} showCourierCodes={showCourierCodes} />
        </CardBody>
      </Card>
    </div>
  );
}
