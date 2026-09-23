'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ListRow } from '@skydrop/ui/app/list-row';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Package } from 'lucide-react';
import '../../_components/benches.css';
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
      <section className="wh-card">
        <SkeletonRows rows={4} cols={3} label="Loading the pack queue" />
      </section>
    );
  }
  if (q.isError) {
    return <ErrorState message="Could not load the pack queue." retry={() => void q.refetch()} />;
  }

  const waiting = q.data ?? [];
  if (waiting.length === 0) {
    return (
      <EmptyState
        tone="positive"
        title="Nothing waiting to be packed"
        description="Parcels appear here once they have been picked. Scan a shipping label to open a box."
      />
    );
  }

  const unlabelled = waiting.filter((w) => w.labelPrintedAtIso === null).length;

  return (
    <section className="wh-card" data-flush="1">
      <div className="wh-card__head">
        <h2 className="wh-card__title">
          <span className="sk-figure">{waiting.length}</span> waiting to be packed
        </h2>
        <div className="wh-card__sub">Oldest first. Scan a label below to start on it.</div>
      </div>
      {unlabelled > 0 && (
        <p className="wh-card__note">
          {unlabelled} {unlabelled === 1 ? 'parcel has' : 'parcels have'} no printed label yet — a
          box is opened by scanning one, so print from{' '}
          <Link href="/warehouse/printing" className="wh-link">
            printing
          </Link>{' '}
          first.
        </p>
      )}
      <ul className="wh-list">
        {waiting.map((w) => (
          <WaitingRow key={w.shipmentId} pack={w} />
        ))}
      </ul>
    </section>
  );
}

function WaitingRow({ pack }: { pack: WaitingPack }): ReactElement {
  const labelled = pack.labelPrintedAtIso !== null;
  return (
    <li>
      <ListRow
        icon={<Package size={16} />}
        title={<span className="sk-ident">{pack.awbNumber ?? pack.shipmentNumber}</span>}
        description={
          <>
            <span className="sk-ident">{pack.orderNumber ?? '—'}</span>
            {pack.recipientName === null ? '' : ` · ${pack.recipientName}`} · {pack.courierCode}
          </>
        }
        meta={
          <span className="sk-figure">
            {pack.itemCount} {pack.itemCount === 1 ? 'line' : 'lines'}
          </span>
        }
        status={
          labelled ? (
            <StatusChip kind="confirmed" label="Label printed" size="sm" />
          ) : (
            <StatusChip kind="pending" label="No label" size="sm" />
          )
        }
        {...(labelled ? {} : { severity: 'medium' as const, severityLabel: 'Needs a label' })}
      />
    </li>
  );
}
