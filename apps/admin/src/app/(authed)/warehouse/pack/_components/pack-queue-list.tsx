'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { Card, CardBody, EmptyState, ErrorState, SkeletonRows } from '@skydrop/ui/components';
import { Printer } from 'lucide-react';
import { usePackQueue, type WaitingPack } from '@/lib/api-hooks';

/**
 * What is waiting on the bench.
 *
 * The station is scan-driven and had nothing else on it, so a packer
 * could only discover a parcel by holding its label — which answers
 * "what is this?" and never "what is left?". This is that second
 * question: oldest first, the same set and the same predicate the pull
 * uses, so the list can never show a parcel the bench would refuse.
 *
 * It is a VIEW. Nothing here claims a parcel — the box does that, and
 * claiming from a list would let a click take a parcel out from under
 * somebody already holding it.
 *
 * A parcel with no printed label is called out rather than hidden: it
 * is the one thing on this list somebody has to go and DO something
 * about, because a box is opened by scanning a label that does not yet
 * exist.
 */
export function PackQueueList(): ReactElement {
  const q = usePackQueue();

  if (q.isLoading) {
    return (
      <Card>
        <CardBody>
          <SkeletonRows rows={4} />
        </CardBody>
      </Card>
    );
  }
  if (q.isError) {
    return <ErrorState message="Could not load the pack queue." retry={() => void q.refetch()} />;
  }

  const waiting = q.data ?? [];
  if (waiting.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting to be packed"
        description="Parcels appear here once they have been picked. Scan a shipping label to open a box."
      />
    );
  }

  const unlabelled = waiting.filter((w) => w.labelPrintedAtIso === null).length;

  return (
    <Card>
      <CardBody className="p-0">
        <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
          <div className="text-text-bright text-sm font-medium">
            {waiting.length} waiting to be packed
          </div>
          <div className="text-text-faint text-xs">
            Oldest first. Scan a label below to start on it.
          </div>
        </div>
        {unlabelled > 0 && (
          <p className="text-text-muted border-border border-b px-4 py-2 text-xs">
            {unlabelled} {unlabelled === 1 ? 'parcel has' : 'parcels have'} no printed label yet — a
            box is opened by scanning one, so print from{' '}
            <Link href="/warehouse/printing" className="hover:text-text underline">
              printing
            </Link>{' '}
            first.
          </p>
        )}
        <ul className="divide-border divide-y">
          {waiting.map((w) => (
            <WaitingRow key={w.shipmentId} pack={w} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function WaitingRow({ pack }: { pack: WaitingPack }): ReactElement {
  const labelled = pack.labelPrintedAtIso !== null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0">
        <div className="text-text-bright font-mono text-sm">
          {pack.awbNumber ?? pack.shipmentNumber}
        </div>
        <div className="text-text-faint truncate text-xs">
          {pack.orderNumber ?? '—'}
          {pack.recipientName === null ? '' : ` · ${pack.recipientName}`} · {pack.courierCode}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-text-muted text-xs tabular-nums">
          {pack.itemCount} {pack.itemCount === 1 ? 'line' : 'lines'}
        </span>
        {labelled ? (
          <span className="text-text-faint text-xs">label printed</span>
        ) : (
          <span className="text-status-pending-fg inline-flex items-center gap-1 text-xs">
            <Printer size={13} /> no label
          </span>
        )}
      </div>
    </li>
  );
}
