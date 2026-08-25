'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  CardBody,
  ErrorState,
  Ident,
  ShipmentStatusBadge,
  SkeletonRows,
} from '@skydrop/ui/components';
import type { ShipmentStatus } from '@skydrop/db';
import { useOrderTracking } from '@/lib/api-hooks';
import { ParcelTimeline } from '../../tracking/_components/parcel-timeline';

/**
 * The parcels on this order and where each one got to.
 *
 * Keyed on the ORDER, not the AWB, because that is what the seller is
 * already looking at. Sending them to a tracking page to paste a number
 * they would have to find first is the gap this closes.
 *
 * Shares the timeline component with the tracking page rather than
 * rendering scans a second way — two renderings of the same events drift
 * the moment either is touched.
 */
export function OrderParcelTracking({ orderId }: { readonly orderId: string }): ReactElement {
  const tracking = useOrderTracking(orderId);

  if (tracking.isLoading) return <SkeletonRows rows={3} cols={1} />;
  if (tracking.isError) {
    return (
      <ErrorState
        message={tracking.error?.message ?? 'Failed to load tracking.'}
        retry={() => void tracking.refetch()}
      />
    );
  }

  const parcels = tracking.data?.items ?? [];
  if (parcels.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-muted text-sm">
            No parcel has left for this order yet. Tracking appears once it has been handed to the
            courier.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {parcels.map((p) => (
        <Card key={p.shipmentId}>
          <CardBody>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Ident value={p.awbNumber ?? p.shipmentNumber} />
              <ShipmentStatusBadge status={p.status as ShipmentStatus} />
              <span className="text-text-faint text-xs">{p.courierCode}</span>
              <Link href="/tracking" className="text-accent ml-auto text-xs hover:underline">
                All parcels →
              </Link>
            </div>
            <ParcelTimeline parcel={p} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
