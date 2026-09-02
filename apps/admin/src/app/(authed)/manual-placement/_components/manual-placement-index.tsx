'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
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
import { useManualPlacementQueue, type ManualPlacementQueueRow } from '@/lib/api-hooks';
import { ManualPlacementPanel } from '../../orders/_components/manual-placement-panel';

/**
 * Every parcel waiting on a person to arrange carriage.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────
 * The form for recording a manual waybill lived on the order detail
 * page, which meant finding the work required already knowing which
 * order to open. There was no list. An order nobody happened to think
 * about simply waited — with its stock reserved, its seller told it was
 * on the way, and no screen anywhere showing it had stopped.
 *
 * ── WHAT AN OPERATOR NEEDS BEFORE THEY RING A COURIER ─────────────────
 * Not just an order number. WHY it is here decides what to do about it:
 * an unserved pincode needs a courier who covers it, while a refused
 * consignee needs the details checking before anyone is paid to carry
 * it. Those look identical in a bare list, so the courier's own words
 * are on the row.
 *
 * WHETHER IT NEEDS PICKING decides what happens after the waybill is
 * typed, and it is the difference between a parcel going out today and
 * one entering the warehouse queue (CUR-8 as amended). Worth knowing
 * BEFORE promising a courier a collection time, not after.
 *
 * HOW LONG IT HAS WAITED is the ordering, because nothing else here
 * escalates on its own.
 *
 * ── THE ROW LEAVES WHEN THE JOB IS DONE ──────────────────────────────
 * The list is derived from live rows — no status is stored — so
 * recording the waybill (or cancelling as unfulfillable) drops the row
 * on the next fetch, which both mutations trigger. There is no separate
 * "done" state to get out of step with the orders themselves.
 */
function waitTone(hours: number): 'draft' | 'pending' | 'failed' {
  // A parcel here is not moving, so age is the only thing that gets
  // worse on its own. Half a day is a working day gone.
  if (hours >= 24) return 'failed';
  if (hours >= 12) return 'pending';
  return 'draft';
}

function reasonLabel(code: string | null): string {
  switch (code) {
    case 'non_serviceable':
      return 'Address not served';
    case 'awb_rejected':
      return 'Courier refused it';
    case 'courier_failure':
      return 'Courier unreachable';
    case 'manual_replacement':
      return 'Replaced by hand';
    default:
      return 'Reason not recorded';
  }
}

function Row({ row }: { row: ManualPlacementQueueRow }): ReactElement {
  return (
    <Tr>
      <Td>
        <Link href={`/orders/${row.orderId}`} className="font-medium">
          {row.orderNumber}
        </Link>
        <div className="text-xs text-text-muted">{row.sellerCompanyName ?? row.sellerId}</div>
      </Td>
      <Td>
        <div>{row.destCity || '—'}</div>
        <div className="text-xs text-text-muted tabular-nums">{row.destPostalCode}</div>
      </Td>
      <Td>{row.codAmountInr === null ? '—' : <Money amount={row.codAmountInr} />}</Td>
      <Td>
        <div className="text-sm">{reasonLabel(row.reasonCode)}</div>
        {/* The courier's own sentence, verbatim. A paraphrase of
            "[ER0005] suspicious order/consignee" loses the only part
            that tells an operator what to actually check. */}
        {row.reason !== null && (
          <div className="mt-0.5 max-w-md text-xs text-text-muted">{row.reason}</div>
        )}
      </Td>
      <Td>
        {row.needsPicking ? (
          <StatusBadge kind="pending" label="Needs picking" />
        ) : (
          <StatusBadge kind="confirmed" label="Ready to go" />
        )}
      </Td>
      <Td>
        <StatusBadge
          kind={waitTone(row.waitingHours)}
          label={row.waitingHours < 1 ? 'just now' : `${row.waitingHours}h`}
        />
      </Td>
      <Td>
        <ManualPlacementPanel
          shipmentId={row.shipmentId}
          shipmentNumber={row.shipmentNumber}
          hasAwb={false}
        />
      </Td>
    </Tr>
  );
}

export function ManualPlacementIndex(): ReactElement {
  const queue = useManualPlacementQueue();

  return (
    <Section>
      <PageHeader
        title="Manual placement"
        subtitle="Parcels no integrated courier would carry. Each one is waiting on a person to arrange carriage and type the waybill back in — nothing here moves on its own."
      />

      <Card>
        <CardBody>
          {queue.isLoading ? (
            <LoadingState label="Loading the worklist…" />
          ) : queue.isError ? (
            <ErrorState
              message={queue.error?.message ?? 'Could not load the worklist.'}
              retry={() => void queue.refetch()}
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Destination</Th>
                  <Th>COD</Th>
                  <Th>Why it is here</Th>
                  <Th>After the waybill</Th>
                  <Th>Waiting</Th>
                  <Th>Place it</Th>
                </Tr>
              </THead>
              <TBody>
                {(queue.data ?? []).length === 0 ? (
                  <TableEmpty colSpan={7}>
                    <div className="flex flex-col items-center gap-1.5 py-2">
                      <PackageSearch size={20} className="text-text-muted" />
                      <div className="font-medium">Nothing waiting on manual placement</div>
                      <div className="text-xs text-text-muted">
                        Every confirmed parcel has a courier. Orders appear here when one refuses to
                        carry them.
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
