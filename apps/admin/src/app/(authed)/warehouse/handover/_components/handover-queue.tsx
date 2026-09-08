'use client';

import type { ReactElement } from 'react';
import { Card, CardBody, EmptyState, ErrorState, SkeletonRows } from '@skydrop/ui/components';
import { Check } from 'lucide-react';
import { useHandoverQueue, type WaitingHandover } from '@/lib/ops-hooks';

/**
 * What is standing at the bench, waiting for a van.
 *
 * The question a loader actually asks — "is that everything?" — was
 * unanswerable here: the bench had a scan box and a list of what had
 * already been done, so the only way to know what was LEFT was to count
 * boxes on the floor. It draws from the same `HANDOVER_READY` set the
 * scan enforces, so it can never offer a parcel the scan would refuse.
 *
 * A parcel already scanned stays on the list, marked, until it is
 * dispatched. Removing rows as they are scanned makes the remaining pile
 * impossible to check against — and a half-loaded van is precisely when
 * somebody needs to.
 */
export function HandoverQueue(): ReactElement {
  const q = useHandoverQueue();

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
    return <ErrorState message="Could not load what is waiting." retry={() => void q.refetch()} />;
  }

  const waiting = q.data ?? [];
  if (waiting.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting for a van"
        description="Parcels appear here once they are packed. Scan a label above when a driver arrives."
      />
    );
  }

  const scanned = waiting.filter((w) => w.handoverScannedAtIso !== null).length;

  return (
    <Card>
      <CardBody className="p-0">
        <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
          <div className="text-text-bright text-sm font-medium">
            {waiting.length} waiting for a van
          </div>
          <div className="text-text-faint text-xs">
            {scanned > 0 ? `${scanned} already checked · ` : ''}oldest first
          </div>
        </div>
        <ul className="divide-border divide-y">
          {waiting.map((w) => (
            <WaitingRow key={w.shipmentId} pack={w} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function WaitingRow({ pack }: { pack: WaitingHandover }): ReactElement {
  const checked = pack.handoverScannedAtIso !== null;
  return (
    <li
      className={
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 ' +
        (checked ? 'text-text-faint' : '')
      }
    >
      <div className="min-w-0">
        <div className={'font-mono text-sm ' + (checked ? '' : 'text-text-bright')}>
          {pack.awbNumber}
        </div>
        <div className="text-text-faint truncate text-xs">
          {pack.shipmentNumber} · {pack.orderNumber ?? '—'}
          {pack.recipientName === null ? '' : ` · ${pack.recipientName}`} · {pack.courierCode}
        </div>
      </div>
      {checked ? (
        <span className="text-status-delivered-fg flex shrink-0 items-center gap-1 text-xs">
          <Check size={13} /> checked
        </span>
      ) : (
        <span className="text-text-muted shrink-0 text-xs">not scanned</span>
      )}
    </li>
  );
}
