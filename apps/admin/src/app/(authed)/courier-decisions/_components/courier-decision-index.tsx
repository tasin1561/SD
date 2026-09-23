'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AgeChip, OoSection, type AgeTone } from '../../orders/_components/order-ops-parts';
import './courier-decisions.css';
import {
  useChooseCourier,
  useCourierDecisionQueue,
  type CourierOptionRow,
  type WaitingCourierChoice,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * CUR-17 — parcels held between call confirmation and printing because
 * the seller's policy says a PERSON picks the carrier.
 *
 * ── WHAT SOMEBODY NEEDS TO DECIDE ────────────────────────────────────
 * Price and days, side by side, for every carrier that was actually
 * quoted. Not a dropdown of names: the choice IS the trade between
 * those two numbers, and hiding one of them behind a select turns a
 * decision into a guess.
 *
 * The cheapest and the fastest are marked, because in a list of eight
 * near-identical rows they are the two anybody is looking for, and
 * scanning for them by eye is where a wrong row gets clicked.
 *
 * ── HOW LONG IT HAS WAITED, LOUDLY ───────────────────────────────────
 * A parcel here is confirmed: its stock is reserved and its customer
 * has been told it is coming. Nothing about that is visible from the
 * order list, so the wait is the most prominent thing on the row — and
 * past the TTL the system books the cheapest itself and says so, which
 * is stated on the page rather than left to be discovered.
 */
function waitTone(hours: number): AgeTone {
  if (hours >= 6) return 'late';
  if (hours >= 2) return 'aging';
  return 'fresh';
}

function hoursSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

function OptionButton({
  option,
  best,
  fastest,
  onPick,
  busy,
}: {
  option: CourierOptionRow;
  best: boolean;
  fastest: boolean;
  onPick: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <button type="button" onClick={onPick} disabled={busy} className="oq-option">
      <span className="oq-option__main">
        <span className="oq-option__name">{option.courierName}</span>
        <span className="oo-faint">
          {option.estimatedDays === null
            ? 'no estimate given'
            : `${option.estimatedDays} day${option.estimatedDays === 1 ? '' : 's'}`}
          {best && ' · cheapest'}
          {fastest && ' · fastest'}
        </span>
      </span>
      <span className="oq-option__rate sk-figure">
        <Money amount={option.rateInr} />
      </span>
    </button>
  );
}

function Row({ row }: { row: WaitingCourierChoice }): ReactElement {
  const choose = useChooseCourier();
  const [error, setError] = useState<string | null>(null);
  const waited = hoursSince(row.waitingSince);

  // Computed here rather than on the server so the marks always agree
  // with the numbers rendered beside them — a "cheapest" badge that
  // disagrees with the prices on screen is worse than no badge.
  const cheapestId = row.options.reduce<CourierOptionRow | null>(
    (a, b) => (a === null || b.rateInr < a.rateInr ? b : a),
    null,
  )?.courierCompanyId;
  const fastestId = row.options
    .filter((o) => o.estimatedDays !== null)
    .reduce<CourierOptionRow | null>(
      (a, b) => (a === null || (b.estimatedDays ?? 0) < (a.estimatedDays ?? 0) ? b : a),
      null,
    )?.courierCompanyId;

  return (
    <Tr>
      <Td>
        <Link href={`/orders/${row.orderId}`} className="oo-link sk-ident">
          {row.orderNumber}
        </Link>
        <span className="oo-sub">{row.sellerCompanyName}</span>
      </Td>
      <Td>
        <span>{row.destCity || '—'}</span>
        <span className="oo-sub sk-figure">{row.destPostalCode}</span>
      </Td>
      <Td>
        <span className="sk-figure">{(row.totalWeightGrams / 1000).toFixed(2)} kg</span>
        {row.codAmountInr !== null && (
          <span className="oo-sub">
            COD <Money amount={row.codAmountInr} />
          </span>
        )}
      </Td>
      <Td>
        <AgeChip tone={waitTone(waited)}>{waited < 1 ? 'just now' : `${waited}h`}</AgeChip>
      </Td>
      <Td>
        {row.options.length === 0 ? (
          <p className="oo-faint">
            No carriers were recorded for this parcel. Booking it will let the aggregator choose.
          </p>
        ) : (
          <div className="oq-options">
            {row.options.map((o) => (
              <OptionButton
                key={o.courierCompanyId}
                option={o}
                best={o.courierCompanyId === cheapestId}
                fastest={o.courierCompanyId === fastestId}
                busy={choose.isPending}
                onPick={() => {
                  setError(null);
                  choose.mutate(
                    { shipmentId: row.shipmentId, courierCompanyId: o.courierCompanyId },
                    // FE-2 — the server's verdict verbatim. It refuses a
                    // carrier it never offered and a parcel that already
                    // has a waybill, and both of those are things the
                    // person clicking needs to read rather than have
                    // paraphrased.
                    { onError: (e) => setError(serverVerdict(e)) },
                  );
                }}
              />
            ))}
          </div>
        )}
        {error !== null && (
          <p className="oo-error" role="alert">
            {error}
          </p>
        )}
      </Td>
    </Tr>
  );
}

export function CourierDecisionIndex(): ReactElement {
  const queue = useCourierDecisionQueue();
  const rows = queue.data ?? [];

  return (
    <div className="oo-page">
      <PageHeader
        title="Courier decisions"
        subtitle="Confirmed parcels waiting for somebody to pick which carrier ships them. Their stock is already reserved and their customers have been told they are coming, so the wait is real — if nobody chooses, the cheapest option is booked automatically and an issue is raised saying so."
      />

      <OoSection
        title="Waiting for a carrier"
        note={queue.data === undefined ? undefined : `${rows.length} waiting`}
        flush
      >
        {queue.isLoading ? (
          <div className="oo-card__pad">
            <SkeletonRows rows={4} cols={5} label="Loading the queue…" />
          </div>
        ) : queue.isError ? (
          <div className="oo-card__pad">
            <ErrorState
              message={queue.error?.message ?? 'Could not load the queue.'}
              retry={() => void queue.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            tone="positive"
            icon={<Truck size={20} />}
            title="Nothing waiting on a decision"
            description="Orders appear here only for sellers whose courier policy is set to Manual, and only when the aggregator offered more than one carrier."
          />
        ) : (
          <Table caption="Parcels waiting for a carrier">
            <THead>
              <Tr>
                <Th>Order</Th>
                <Th>Destination</Th>
                <Th>Parcel</Th>
                <Th>Waiting</Th>
                <Th>Pick a carrier</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Row key={row.shipmentId} row={row} />
              ))}
            </TBody>
          </Table>
        )}
      </OoSection>
    </div>
  );
}
