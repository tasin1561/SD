'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { PackageCheck, Truck } from 'lucide-react';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, TableEmpty, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import '../../_components/benches.css';
import type { AwaitingRtoRow } from '@/lib/api-hooks';

/**
 * Returns that have not reached this bench yet — in two stages.
 *
 * ── WHY THIS LIST HAD TO EXIST ───────────────────────────────────────
 * A return becomes RTO_RECEIVED only when a person receives it at this
 * bench — never from a courier scan (TRK-6), because a webhook driving
 * that would let a bad scan start the restock or write-off with nobody
 * having seen the goods. The rule is right and stays.
 *
 * What was missing was anybody being told. "Waiting on somebody" below
 * lists returns ALREADY received; a parcel the courier had handed back
 * and nobody had received appeared on no screen at all. One sat that way
 * for five days — order stuck in RTO in transit, seller being told their
 * goods were still travelling — and was found by a person noticing an
 * order looked odd.
 *
 * ── TWO STAGES, KEPT APART ───────────────────────────────────────────
 * AT OUR DOOR is a worklist: somebody has to receive each of these, and
 * the age is a count of how long a seller has been misinformed.
 *
 * STILL WITH THE COURIER is not a worklist and is presented as one only
 * by accident if the two are merged — there is nothing to do about a
 * parcel the courier is still carrying. It is here because a bench that
 * knows six returns are coming is different from one that is surprised
 * by them, and because a return that has been "in transit" for weeks is
 * visible nowhere else.
 *
 * Merging them would make the first list's urgency meaningless: a
 * screenful of rows nobody can act on is how people stop reading a
 * screen.
 */
function waitTone(hours: number, stage: AwaitingRtoRow['stage']): 'draft' | 'pending' | 'failed' {
  // Time means different things in the two stages. At our door it is
  // somebody not doing something; with the courier it is just travel,
  // until it has gone on so long that the parcel is probably lost.
  if (stage === 'ON_THE_WAY') return hours >= 14 * 24 ? 'failed' : 'draft';
  if (hours >= 48) return 'failed';
  if (hours >= 12) return 'pending';
  return 'draft';
}

/** Their vocabulary, in ours — the bench reads this, not an enum. */
function courierStage(status: string): string {
  switch (status) {
    case 'RTO_INITIATED':
      return 'turning around';
    case 'RTO_IN_TRANSIT':
      return 'on its way back';
    case 'RTO_DELIVERED':
      return 'handed back';
    default:
      return status.toLowerCase().replaceAll('_', ' ');
  }
}

function Row({
  row,
  onPick,
}: {
  readonly row: AwaitingRtoRow;
  readonly onPick?: (awb: string) => void;
}): ReactElement {
  return (
    <Tr>
      <Td>
        <button
          type="button"
          onClick={() => onPick !== undefined && row.awbNumber !== null && onPick(row.awbNumber)}
          disabled={onPick === undefined || row.awbNumber === null}
          className="wh-awb-pick sk-ident"
          title={
            onPick === undefined || row.awbNumber === null
              ? undefined
              : 'Load this AWB into the receive box'
          }
        >
          {row.awbNumber ?? row.shipmentNumber}
        </button>
        <div className="wh-faint">{row.courierCode}</div>
      </Td>
      <Td>
        {row.orderId === null ? (
          <span className="wh-faint">—</span>
        ) : (
          <Link href={`/orders/${row.orderId}`} className="sk-ident wh-cell-link">
            {row.orderNumber}
          </Link>
        )}
        <div className="wh-faint">{row.sellerName ?? '—'}</div>
      </Td>
      <Td align="right" className="sk-figure">
        {row.itemCount}
      </Td>
      <Td className="wh-note">{courierStage(row.shipmentStatus)}</Td>
      <Td>
        <StatusChip
          kind={waitTone(row.waitingHours, row.stage)}
          label={row.waitingHours < 1 ? 'just now' : `${row.waitingHours}h`}
          size="sm"
        />
      </Td>
    </Tr>
  );
}

export function AtOurDoorList({
  rows,
  onPick,
}: {
  readonly rows: readonly AwaitingRtoRow[];
  /** Fills the receive box AND moves to the Receive tab — the person
   *  reading this list is the one who will scan the parcel, and a click
   *  that quietly filled a field on another tab would look like nothing
   *  happened. */
  readonly onPick: (awb: string) => void;
}): ReactElement {
  return (
    <ReturnsTable
      rows={rows}
      onPick={onPick}
      emptyIcon={<PackageCheck size={22} className="wh-empty-cell__icon" />}
      emptyTitle="Nothing waiting to be received"
      emptyHint="Every parcel a courier has marked returned has been received here."
    />
  );
}

export function StillWithCourierList({
  rows,
}: {
  readonly rows: readonly AwaitingRtoRow[];
}): ReactElement {
  return (
    <ReturnsTable
      rows={rows}
      // Nothing to click: the courier still has these, so there is no
      // parcel to receive and a clickable AWB would promise an action
      // that cannot be taken yet.
      emptyIcon={<Truck size={22} className="wh-empty-cell__icon" />}
      emptyTitle="No returns in transit"
      emptyHint="Nothing is currently on its way back to the warehouse."
    />
  );
}

function ReturnsTable({
  rows,
  onPick,
  emptyIcon,
  emptyTitle,
  emptyHint,
}: {
  readonly rows: readonly AwaitingRtoRow[];
  readonly onPick?: (awb: string) => void;
  readonly emptyIcon: ReactElement;
  readonly emptyTitle: string;
  readonly emptyHint: string;
}): ReactElement {
  return (
    <Table caption="Returns">
      <THead>
        <Tr>
          <Th>Parcel</Th>
          <Th>Order</Th>
          <Th align="right">Items</Th>
          <Th>Courier says</Th>
          <Th>Waiting</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={5}>
            <div className="wh-empty-cell">
              {emptyIcon}
              <div className="wh-empty-cell__title">{emptyTitle}</div>
              <div className="wh-note">{emptyHint}</div>
            </div>
          </TableEmpty>
        ) : (
          rows.map((r) => (
            <Row key={r.shipmentId} row={r} {...(onPick === undefined ? {} : { onPick })} />
          ))
        )}
      </TBody>
    </Table>
  );
}
