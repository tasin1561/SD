'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import {
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
function waitTone(hours: number): 'draft' | 'pending' | 'failed' {
  if (hours >= 6) return 'failed';
  if (hours >= 2) return 'pending';
  return 'draft';
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
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="flex w-full items-baseline justify-between gap-3 rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:border-accent disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm">{option.courierName}</span>
        <span className="text-xs text-text-muted">
          {option.estimatedDays === null
            ? 'no estimate given'
            : `${option.estimatedDays} day${option.estimatedDays === 1 ? '' : 's'}`}
          {best && ' · cheapest'}
          {fastest && ' · fastest'}
        </span>
      </span>
      <span className="shrink-0 tabular-nums text-sm">
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
        <Link href={`/orders/${row.orderId}`} className="font-medium">
          {row.orderNumber}
        </Link>
        <div className="text-xs text-text-muted">{row.sellerCompanyName}</div>
      </Td>
      <Td>
        <div>{row.destCity || '—'}</div>
        <div className="text-xs text-text-muted tabular-nums">{row.destPostalCode}</div>
      </Td>
      <Td>
        <div className="tabular-nums text-sm">{(row.totalWeightGrams / 1000).toFixed(2)} kg</div>
        {row.codAmountInr !== null && (
          <div className="text-xs text-text-muted">
            COD <Money amount={row.codAmountInr} />
          </div>
        )}
      </Td>
      <Td>
        <StatusBadge kind={waitTone(waited)} label={waited < 1 ? 'just now' : `${waited}h`} />
      </Td>
      <Td>
        {row.options.length === 0 ? (
          <div className="text-xs text-text-muted">
            No carriers were recorded for this parcel. Booking it will let the aggregator choose.
          </div>
        ) : (
          <div className="flex max-w-md flex-col gap-1.5">
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
        {error !== null && <div className="mt-1.5 text-xs text-status-failed">{error}</div>}
      </Td>
    </Tr>
  );
}

export function CourierDecisionIndex(): ReactElement {
  const queue = useCourierDecisionQueue();

  return (
    <Section>
      <PageHeader
        title="Courier decisions"
        subtitle="Confirmed parcels waiting for somebody to pick which carrier ships them. Their stock is already reserved and their customers have been told they are coming, so the wait is real — if nobody chooses, the cheapest option is booked automatically and an issue is raised saying so."
      />

      <Card>
        <CardBody>
          {queue.isLoading ? (
            <LoadingState label="Loading the queue…" />
          ) : queue.isError ? (
            <ErrorState
              message={queue.error?.message ?? 'Could not load the queue.'}
              retry={() => void queue.refetch()}
            />
          ) : (
            <Table>
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
                {(queue.data ?? []).length === 0 ? (
                  <TableEmpty colSpan={5}>
                    <div className="flex flex-col items-center gap-1.5 py-2">
                      <Truck size={20} className="text-text-muted" />
                      <div className="font-medium">Nothing waiting on a decision</div>
                      <div className="text-xs text-text-muted">
                        Orders appear here only for sellers whose courier policy is set to Manual,
                        and only when the aggregator offered more than one carrier.
                      </div>
                    </div>
                  </TableEmpty>
                ) : (
                  (queue.data ?? []).map((row) => <Row key={row.shipmentId} row={row} />)
                )}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
