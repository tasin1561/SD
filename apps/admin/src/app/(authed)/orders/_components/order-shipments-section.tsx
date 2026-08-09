'use client';

import type { ReactElement } from 'react';
import { ExternalLink } from 'lucide-react';
import { Card, CardBody, ErrorState, LoadingState } from '@skydrop/ui/components';
import { useAdminOrderShipments } from '@/lib/api-hooks';
import { CourierOpsPanel } from './courier-ops-panel';
import { ManualScanPanel } from './manual-scan-panel';
import { ManualPlacementPanel } from './manual-placement-panel';

const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL ?? 'https://track.skydrop.online';

/**
 * Shipments associated with the order. For each shipment with an AWB
 * a "View public tracking" deep-link is rendered — points to
 * track.skydrop.online/<awb>. Useful when an operator wants to see
 * exactly what the customer sees.
 */
export function OrderShipmentsSection({
  orderId,
  orderStatus,
}: {
  readonly orderId: string;
  /** Gates the manual-placement actions. Passed down rather than
   *  re-fetched: the parent already has it, and two reads of the same
   *  status can disagree for a moment after a dispatch. */
  readonly orderStatus: string;
}): ReactElement {
  const shipments = useAdminOrderShipments(orderId);

  if (shipments.isLoading) return <LoadingState label="Loading shipments…" />;
  if (shipments.isError)
    return (
      <ErrorState
        message={shipments.error?.message ?? 'Failed to load shipments.'}
        retry={() => void shipments.refetch()}
      />
    );
  if (!shipments.data || shipments.data.length === 0)
    return (
      <Card>
        <CardBody className="text-text-muted text-sm">
          No shipments yet. A shipment is provisioned when the order is confirmed.
        </CardBody>
      </Card>
    );

  return (
    <Card>
      <CardBody className="p-0">
        <ol className="divide-y divide-border">
          {shipments.data.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-text-bright text-sm font-mono">{s.shipmentNumber}</div>
                  <div className="text-text-faint text-xs mt-0.5">
                    {s.status} · {s.courierCode}
                    {s.isManualCourier ? ' (manual)' : ''} ·{' '}
                    {new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                    {s.supersedesShipmentId && (
                      <span className="ml-1 text-text-muted">· supersede</span>
                    )}
                  </div>
                  {s.awbNumber && (
                    <div className="text-text-muted text-xs mt-0.5 font-mono">
                      AWB {s.awbNumber}
                    </div>
                  )}
                </div>
                {s.awbNumber && (
                  <a
                    href={`${TRACK_URL}/${encodeURIComponent(s.awbNumber)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent-hover text-xs inline-flex items-center gap-1 shrink-0"
                  >
                    Public tracking <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <div className="mt-2 space-y-2">
                <CourierOpsPanel
                  shipmentId={s.id}
                  awbNumber={s.awbNumber ?? null}
                  isManualCourier={s.isManualCourier}
                />
                {/* The recovery path when a courier webhook never arrived. */}
                <ManualScanPanel shipmentId={s.id} />

                {/* Only for an order actually stuck at manual placement.
                    Rendering it always would offer a dispatch button on
                    parcels a courier already has. */}
                {orderStatus === 'PENDING_MANUAL_PLACEMENT' && (
                  <ManualPlacementPanel
                    shipmentId={s.id}
                    shipmentNumber={s.shipmentNumber}
                    hasAwb={s.awbNumber !== null}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
