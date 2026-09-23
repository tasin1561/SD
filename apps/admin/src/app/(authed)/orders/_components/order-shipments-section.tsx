'use client';

import type { ReactElement } from 'react';
import { ExternalLink, PackageOpen } from 'lucide-react';
import { ShipmentStatus } from '@skydrop/db';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useAdminOrderShipments } from '@/lib/api-hooks';
import { CourierOpsPanel } from './courier-ops-panel';
import { ShipmentCostPanel } from './shipment-cost-panel';
import { courierLabel, shipmentStatusKind, statusLabel } from '@skydrop/ui/status';
import { ManualScanPanel } from './manual-scan-panel';
import { ManualPlacementPanel } from './manual-placement-panel';
import { OoCard } from './order-ops-parts';
import './order-shipping.css';

const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL ?? 'https://track.skydrop.online';

const KNOWN_SHIPMENT_STATUSES: readonly string[] = Object.values(ShipmentStatus);

/** The status chip; a value the vocabulary does not know is shown as sent. */
function ShipmentChip({ status }: { readonly status: string }): ReactElement {
  if (KNOWN_SHIPMENT_STATUSES.includes(status)) {
    const s = status as ShipmentStatus;
    return <StatusChip size="sm" kind={shipmentStatusKind(s)} label={statusLabel(s)} />;
  }
  return <StatusChip size="sm" kind="neutral" label={status} />;
}

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

  if (shipments.isLoading) return <SkeletonRows rows={2} cols={3} label="Loading shipments…" />;
  if (shipments.isError)
    return (
      <ErrorState
        message={shipments.error?.message ?? 'Failed to load shipments.'}
        retry={() => void shipments.refetch()}
      />
    );
  if (!shipments.data || shipments.data.length === 0)
    return (
      <EmptyState
        icon={<PackageOpen size={20} />}
        title="No shipments yet"
        description="No shipments yet. A shipment is provisioned when the order is confirmed."
      />
    );

  return (
    <OoCard flush>
      <ol className="os-list">
        {shipments.data.map((s) => (
          <li key={s.id} className="os-item">
            <div className="os-item__head">
              <div className="oo-stack oo-stack--tight">
                <div className="os-item__id">
                  <span className="os-item__number sk-ident">{s.shipmentNumber}</span>
                  <ShipmentChip status={s.status} />
                </div>
                <div className="os-item__meta">
                  {courierLabel(s.courierCode, s.manualCourierName)}
                  {/* Which of our accounts with that courier carried it.
                      One courier is several accounts, and the label,
                      the cancel and the cost are all addressed from
                      this one — so "which account" is the first thing
                      asked when a parcel goes wrong. */}
                  {s.courierAccountLabel === null ? null : ` · ${s.courierAccountLabel}`}
                  {/* WHICH CARRIER an aggregator picked. `courierCode`
                      says who we booked with and hold the account
                      with; this says whose van it is in, and it is the
                      first thing anyone needs when chasing a POD or
                      asking why a parcel is slow. Absent for Delhivery
                      (they are the carrier) and for parcels booked
                      before we recorded it, so it is shown only when
                      we have it rather than rendered as an em dash
                      beside every Delhivery row. */}
                  {s.carrierName === null ? null : ` · via ${s.carrierName}`}
                  {s.isManualCourier ? ' (placed by hand)' : ''} ·{' '}
                  <span className="sk-figure">
                    {new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                  {s.supersedesShipmentId && <span> · supersede</span>}
                </div>
                {s.awbNumber && (
                  <div className="os-item__awb">
                    AWB <span className="sk-ident">{s.awbNumber}</span>
                  </div>
                )}
              </div>
              {s.awbNumber && (
                <a
                  href={`${TRACK_URL}/${encodeURIComponent(s.awbNumber)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="os-track"
                >
                  Public tracking <ExternalLink size={13} aria-hidden />
                </a>
              )}
            </div>
            <div className="oo-stack oo-stack--tight">
              <CourierOpsPanel
                shipmentId={s.id}
                awbNumber={s.awbNumber ?? null}
                isManualCourier={s.isManualCourier}
                status={s.status}
                courierCancelledAt={s.courierCancelledAt}
              />
              <div className="os-tools">
                {/* The recovery path when a courier webhook never arrived. */}
                <ManualScanPanel shipmentId={s.id} />

                {/* What it actually cost us. The lane-margin report
                    fills the forward figure automatically but is sampled
                    and rate-limited, and the return leg has no automatic
                    source at all. */}
                <ShipmentCostPanel
                  shipmentId={s.id}
                  shipmentNumber={s.shipmentNumber}
                  awbNumber={s.awbNumber ?? null}
                  wasReturned={String(orderStatus).startsWith('RTO')}
                />
              </div>

              {/* Only for an order actually stuck at manual placement,
                  and only on the LIVE shipment.
                  Rendering it always would offer a dispatch button on
                  parcels a courier already has.

                  The retired half matters too: a refusal RETIRES the
                  old shipment and creates a replacement (CUR-7), so an
                  order here usually has two — and this card lists both.
                  Without the status test an operator sees two identical
                  forms, one of which is refused by the server with
                  SHIPMENT_NOT_MANUAL_ELIGIBLE. Nothing breaks, but
                  finding that out by typing a waybill into the wrong
                  one is a poor way to learn which is which. */}
              {orderStatus === 'PENDING_MANUAL_PLACEMENT' && s.status === 'CREATED' && (
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
    </OoCard>
  );
}
