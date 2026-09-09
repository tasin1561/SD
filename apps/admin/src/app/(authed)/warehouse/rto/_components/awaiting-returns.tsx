'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { PackageCheck, Truck } from 'lucide-react';
import {
  Card,
  CardBody,
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
import { useAwaitingRtoReceipt, type AwaitingRtoRow } from '@/lib/api-hooks';

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
  readonly onPick: (awb: string) => void;
}): ReactElement {
  return (
    <Tr>
      <Td>
        <button
          type="button"
          onClick={() => row.awbNumber !== null && onPick(row.awbNumber)}
          disabled={row.awbNumber === null}
          className="hover:text-accent text-left font-mono text-xs disabled:cursor-default disabled:hover:text-inherit"
          title={row.awbNumber === null ? undefined : 'Load this AWB into the receive box'}
        >
          {row.awbNumber ?? row.shipmentNumber}
        </button>
        <div className="text-text-muted text-xs">{row.courierCode}</div>
      </Td>
      <Td>
        {row.orderId === null ? (
          <span className="text-text-muted">—</span>
        ) : (
          <Link href={`/orders/${row.orderId}`} className="font-medium">
            {row.orderNumber}
          </Link>
        )}
        <div className="text-text-muted text-xs">{row.sellerName ?? '—'}</div>
      </Td>
      <Td className="tabular-nums">{row.itemCount}</Td>
      <Td className="text-text-muted text-xs">{courierStage(row.shipmentStatus)}</Td>
      <Td>
        <StatusBadge
          kind={waitTone(row.waitingHours, row.stage)}
          label={row.waitingHours < 1 ? 'just now' : `${row.waitingHours}h`}
        />
      </Td>
    </Tr>
  );
}

export function AwaitingReturns({
  onPick,
}: {
  /** Fills the receive box below — the person reading this list is the
   *  one who will scan the parcel, so retyping the AWB is pure friction. */
  readonly onPick: (awb: string) => void;
}): ReactElement {
  const q = useAwaitingRtoReceipt();
  const items = q.data?.items ?? [];
  const atDoor = items.filter((r) => r.stage === 'RETURNED');
  const coming = items.filter((r) => r.stage === 'ON_THE_WAY');

  if (q.isLoading) {
    return (
      <Section title="Returns not yet on the bench">
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">Reading what the couriers are sending back…</p>
          </CardBody>
        </Card>
      </Section>
    );
  }

  if (q.isError) {
    return (
      <Section title="Returns not yet on the bench">
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">
              Could not read inbound returns. The station below still works if you have an AWB.
            </p>
          </CardBody>
        </Card>
      </Section>
    );
  }

  return (
    <>
      <Section
        title="At our door — receive these"
        subtitle="The courier has handed these back and nobody has received them here yet. Receiving one is what starts its inspection; nothing does it automatically, on purpose."
      >
        <ReturnsTable
          rows={atDoor}
          onPick={onPick}
          emptyIcon={<PackageCheck size={20} className="text-text-muted" />}
          emptyTitle="Nothing waiting to be received"
          emptyHint="Every parcel a courier has marked returned has been received here."
        />
      </Section>

      <Section
        title="Still with the courier"
        subtitle="On their way back. Nothing to do yet — this is here so the bench knows what is coming, and so a return that has been travelling for weeks is visible somewhere."
      >
        <ReturnsTable
          rows={coming}
          onPick={onPick}
          emptyIcon={<Truck size={20} className="text-text-muted" />}
          emptyTitle="No returns in transit"
          emptyHint="Nothing is currently on its way back to the warehouse."
        />
      </Section>
    </>
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
  readonly onPick: (awb: string) => void;
  readonly emptyIcon: ReactElement;
  readonly emptyTitle: string;
  readonly emptyHint: string;
}): ReactElement {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Parcel</Th>
          <Th>Order</Th>
          <Th>Items</Th>
          <Th>Courier says</Th>
          <Th>Waiting</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={5}>
            <div className="flex flex-col items-center gap-1.5 py-2">
              {emptyIcon}
              <div className="font-medium">{emptyTitle}</div>
              <div className="text-text-muted text-xs">{emptyHint}</div>
            </div>
          </TableEmpty>
        ) : (
          rows.map((r) => <Row key={r.shipmentId} row={r} onPick={onPick} />)
        )}
      </TBody>
    </Table>
  );
}
