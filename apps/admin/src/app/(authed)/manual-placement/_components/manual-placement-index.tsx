'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { PackageSearch } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AgeChip, OoSection, type AgeTone } from '../../orders/_components/order-ops-parts';
import {
  useManualPlacementQueue,
  type ManualPlacementQueueRow,
  type SupersedeReasonCode,
} from '@/lib/api-hooks';
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
function waitTone(hours: number): AgeTone {
  // A parcel here is not moving, so age is the only thing that gets
  // worse on its own. Half a day is a working day gone.
  if (hours >= 24) return 'late';
  if (hours >= 12) return 'aging';
  return 'fresh';
}

/**
 * The coded reason, in a few words a person can scan.
 *
 * THE CASES ARE THE PRISMA MEMBER NAMES, not the `@map`ped column
 * values. They were the latter, so the switch matched nothing and
 * EVERY row here read "Reason not recorded" — on the one column this
 * screen exists for, and quietly, because the courier's own sentence
 * sits underneath and reads like the answer. Found by filming it.
 *
 * `code` is now the four-value union, so a fifth `SupersedeReason`
 * fails to compile rather than silently falling through to the
 * default. The default is kept for the genuine case: a replacement
 * shipment with nothing retired behind it, where there is no code at
 * all.
 */
function reasonLabel(code: SupersedeReasonCode | null): string {
  switch (code) {
    case 'NON_SERVICEABLE':
      return 'Address not served';
    case 'AWB_REJECTED':
      return 'Courier refused it';
    case 'COURIER_FAILURE':
      return 'Courier unreachable';
    case 'MANUAL_REPLACEMENT':
      return 'Replaced by hand';
    case null:
      return 'Reason not recorded';
    default: {
      const never: never = code;
      return never;
    }
  }
}

function Row({ row }: { row: ManualPlacementQueueRow }): ReactElement {
  return (
    <Tr>
      <Td>
        <Link href={`/orders/${row.orderId}`} className="oo-link sk-ident">
          {row.orderNumber}
        </Link>
        <span className="oo-sub">{row.sellerCompanyName ?? row.sellerId}</span>
      </Td>
      <Td>
        <span>{row.destCity || '—'}</span>
        <span className="oo-sub sk-figure">{row.destPostalCode}</span>
      </Td>
      <Td>{row.codAmountInr === null ? '—' : <Money amount={row.codAmountInr} />}</Td>
      <Td>
        <span className="oo-strong">{reasonLabel(row.reasonCode)}</span>
        {/* The courier's own sentence, verbatim. A paraphrase of
            "[ER0005] suspicious order/consignee" loses the only part
            that tells an operator what to actually check. */}
        {row.reason !== null && <span className="oo-sub oo-clip">{row.reason}</span>}
      </Td>
      <Td>
        {row.needsPicking ? (
          <StatusChip size="sm" kind="pending" label="Needs picking" />
        ) : (
          <StatusChip size="sm" kind="confirmed" label="Ready to go" />
        )}
      </Td>
      <Td>
        <AgeChip tone={waitTone(row.waitingHours)}>
          {row.waitingHours < 1 ? 'just now' : `${row.waitingHours}h`}
        </AgeChip>
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
  const rows = queue.data ?? [];

  return (
    <div className="oo-page">
      <PageHeader
        title="Manual placement"
        subtitle="Parcels no integrated courier would carry. Each one is waiting on a person to arrange carriage and type the waybill back in — nothing here moves on its own."
      />

      <OoSection
        title="Waiting for a waybill"
        note={queue.data === undefined ? undefined : `${rows.length} waiting`}
        flush
      >
        {queue.isLoading ? (
          <div className="oo-card__pad">
            <SkeletonRows rows={4} cols={7} label="Loading the worklist…" />
          </div>
        ) : queue.isError ? (
          <div className="oo-card__pad">
            <ErrorState
              message={queue.error?.message ?? 'Could not load the worklist.'}
              retry={() => void queue.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            tone="positive"
            icon={<PackageSearch size={20} />}
            title="Nothing waiting on manual placement"
            description="Every confirmed parcel has a courier. Orders appear here when one refuses to carry them."
          />
        ) : (
          <Table caption="Parcels waiting on manual placement">
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
