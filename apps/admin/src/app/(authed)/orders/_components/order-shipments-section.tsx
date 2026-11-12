'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { Ellipsis, ExternalLink, PackageOpen } from 'lucide-react';
import { ShipmentStatus } from '@skydrop/db';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useAdminOrderShipments } from '@/lib/api-hooks';
import { CourierOpsPanel, courierActionsAvailable } from './courier-ops-panel';
import { ShipmentCostPanel } from './shipment-cost-panel';
import { courierLabel, shipmentStatusKind, statusLabel } from '@skydrop/ui/status';
import { ManualScanPanel } from './manual-scan-panel';
import { ManualPlacementPanel } from './manual-placement-panel';
import './order-shipping.css';
import { useT, useLocale } from '@/i18n/client';
import { MenuButton, Money, type MenuEntry } from '@skydrop/ui/components';
import type { JourneyParcelView } from '@skydrop/ui/components';
import { usePermission } from '@/lib/use-permission';
import { CopyButton } from './copy-button';
import { DetailCard } from './detail-card';
import { fmtDate, fmtStamp } from './order-detail-format';

export const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL ?? 'https://track.skydrop.global';

const KNOWN_SHIPMENT_STATUSES: readonly string[] = Object.values(ShipmentStatus);

/** The status chip; a value the vocabulary does not know is shown as sent. */
function ShipmentChip({ status }: { readonly status: string }): ReactElement {
  const locale = useLocale();
  if (KNOWN_SHIPMENT_STATUSES.includes(status)) {
    const s = status as ShipmentStatus;
    return <StatusChip size="sm" kind={shipmentStatusKind(s)} label={statusLabel(s, locale)} />;
  }
  return <StatusChip size="sm" kind="neutral" label={status} />;
}

/**
 * Which shipment's dialog is open. Lifted so the order header's More menu
 * and "Courier actions & costs" button can open the same dialogs a
 * shipment card opens from its own ⋯ — ONE dialog per shipment, however
 * it was reached.
 */
export interface ShipmentDialogState {
  readonly scanFor: string | null;
  readonly costFor: string | null;
  readonly courierFor: string | null;
  readonly setScanFor: (id: string | null) => void;
  readonly setCostFor: (id: string | null) => void;
  readonly setCourierFor: (id: string | null) => void;
}

export function useShipmentDialogState(): ShipmentDialogState {
  const [scanFor, setScanFor] = useState<string | null>(null);
  const [costFor, setCostFor] = useState<string | null>(null);
  const [courierFor, setCourierFor] = useState<string | null>(null);
  return { scanFor, costFor, courierFor, setScanFor, setCostFor, setCourierFor };
}

export { courierActionsAvailable };

/**
 * Shipments associated with the order, as the sidebar's Shipment card:
 * one compact block per shipment — number and status, who carries it, the
 * AWB with copy and the PUBLIC tracking link (track.skydrop.global/<awb>,
 * exactly what the customer sees), the courier's own facts as a two-column
 * list, and the actions. Every action is the one that was here before:
 * the same panels, the same dialogs, the same gating.
 */
export function OrderShipmentsSection({
  orderId,
  orderStatus,
  parcels = [],
  open,
  onOpenChange,
  dialogState,
}: {
  readonly orderId: string;
  /** Gates the manual-placement actions. Passed down rather than
   *  re-fetched: the parent already has it, and two reads of the same
   *  status can disagree for a moment after a dispatch. */
  readonly orderStatus: string;
  /** What the courier says about each parcel (the journey read). */
  readonly parcels?: readonly JourneyParcelView[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly dialogState?: ShipmentDialogState | undefined;
}): ReactElement {
  const t = useT();
  const own = useShipmentDialogState();
  const dialogs = dialogState ?? own;
  const canCost = usePermission('money.treasury.manage');

  const shipments = useAdminOrderShipments(orderId);
  const count = shipments.data?.length ?? 0;

  return (
    <DetailCard
      id="od-shipment"
      title={t('orderDetail.card.shipment')}
      titleText={t('orderDetail.card.shipment')}
      meta={count > 1 ? `(${count})` : undefined}
      open={open}
      onOpenChange={onOpenChange}
    >
      {shipments.isLoading ? (
        <SkeletonRows rows={2} cols={3} label={t('ordersOrderShipmentsSection.loadingShipments')} />
      ) : shipments.isError ? (
        <ErrorState
          message={
            shipments.error?.message ?? t('ordersOrderShipmentsSection.failedToLoadShipments')
          }
          retry={() => void shipments.refetch()}
        />
      ) : !shipments.data || shipments.data.length === 0 ? (
        <EmptyState
          bare
          icon={<PackageOpen size={20} />}
          title={t('ordersOrderShipmentsSection.noShipmentsYet')}
          description={t('ordersOrderShipmentsSection.noShipmentsYetAShipment')}
        />
      ) : (
        <ol className="od-ship-list">
          {shipments.data.map((s) => {
            const parcel = parcels.find((p) => p.shipmentId === s.id) ?? null;
            const entries: MenuEntry[] = [
              {
                kind: 'action',
                id: `scan-${s.id}`,
                label: t('ordersManualScanPanel.recordAScanManually'),
                onSelect: () => dialogs.setScanFor(s.id),
              },
              ...(canCost
                ? [
                    {
                      kind: 'action' as const,
                      id: `cost-${s.id}`,
                      label: t('ordersShipmentCostPanel.recordCourierCost'),
                      onSelect: () => dialogs.setCostFor(s.id),
                    },
                  ]
                : []),
            ];
            return (
              <li key={s.id} className="od-ship" id={`od-ship-${s.id}`}>
                <div className="od-ship__head">
                  <span className="od-ship__number sk-ident">{s.shipmentNumber}</span>
                  <ShipmentChip status={s.status} />
                </div>
                <p className="od-ship__meta">
                  {courierLabel(s.courierCode, s.manualCourierName)}
                  {/* Which of our accounts with that courier carried it.
                      One courier is several accounts, and the label,
                      the cancel and the cost are all addressed from
                      this one — so "which account" is the first thing
                      asked when a parcel goes wrong. */}
                  {s.courierAccountLabel === null ? null : ` · ${s.courierAccountLabel}`}
                  {/* WHICH CARRIER an aggregator picked — whose van it is
                      in, the first thing anyone needs when chasing a POD.
                      Shown only when we have it (absent for Delhivery,
                      who are the carrier). */}
                  {s.carrierName === null
                    ? null
                    : t('ordersOrderShipmentsSection.via', { carrierName: s.carrierName })}
                  {s.isManualCourier ? t('ordersOrderShipmentsSection.placedByHand') : ''} ·{' '}
                  <span className="sk-figure" title={s.createdAt}>
                    {fmtStamp(s.createdAt)}
                  </span>
                  {s.supersedesShipmentId && (
                    <span> {t('ordersOrderShipmentsSection.supersede')}</span>
                  )}
                </p>
                {s.awbNumber && (
                  <p className="od-ship__awb">
                    <span className="sk-ident">{s.awbNumber}</span>
                    <CopyButton value={s.awbNumber} />
                    <a
                      href={`${TRACK_URL}/${encodeURIComponent(s.awbNumber)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="od-link"
                    >
                      {t('ordersOrderShipmentsSection.publicTracking')}{' '}
                      <ExternalLink size={12} aria-hidden />
                    </a>
                  </p>
                )}
                {parcel !== null && <ParcelDl parcel={parcel} />}
                <div className="od-ship__actions">
                  <div className="od-ship__courier">
                    <CourierOpsPanel
                      shipmentId={s.id}
                      awbNumber={s.awbNumber ?? null}
                      isManualCourier={s.isManualCourier}
                      status={s.status}
                      courierCancelledAt={s.courierCancelledAt}
                      open={dialogs.courierFor === s.id}
                      onOpenChange={(next) => dialogs.setCourierFor(next ? s.id : null)}
                    />
                  </div>
                  <MenuButton
                    label={t('orderDetail.header.more')}
                    triggerAriaLabel={t('orderDetail.header.more')}
                    triggerIcon={<Ellipsis size={16} />}
                    triggerClassName="od-iconbtn"
                    className="od-menu"
                    entries={entries}
                  />
                </div>
                {/* The recovery path when a courier webhook never arrived,
                    and what it actually cost us. Both are dialogs now,
                    opened from the ⋯ menu above (or the header's More). */}
                <ManualScanPanel
                  shipmentId={s.id}
                  open={dialogs.scanFor === s.id}
                  onOpenChange={(next) => dialogs.setScanFor(next ? s.id : null)}
                />
                <ShipmentCostPanel
                  shipmentId={s.id}
                  shipmentNumber={s.shipmentNumber}
                  awbNumber={s.awbNumber ?? null}
                  wasReturned={String(orderStatus).startsWith('RTO')}
                  open={dialogs.costFor === s.id}
                  onOpenChange={(next) => dialogs.setCostFor(next ? s.id : null)}
                />

                {/* Only for an order actually stuck at manual placement,
                    and only on the LIVE shipment.
                    Rendering it always would offer a dispatch button on
                    parcels a courier already has.

                    The retired half matters too: a refusal RETIRES the
                    old shipment and creates a replacement (CUR-7), so an
                    order here usually has two — and this card lists both.
                    Without the status test an operator sees two identical
                    forms, one of which is refused by the server with
                    SHIPMENT_NOT_MANUAL_ELIGIBLE. */}
                {orderStatus === 'PENDING_MANUAL_PLACEMENT' && s.status === 'CREATED' && (
                  <ManualPlacementPanel
                    shipmentId={s.id}
                    shipmentNumber={s.shipmentNumber}
                    hasAwb={s.awbNumber !== null}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </DetailCard>
  );
}

/** What the courier says the parcel is — a compact two-column list. */
function ParcelDl({ parcel }: { readonly parcel: JourneyParcelView }): ReactElement {
  const t = useT();
  const dash = <span className="od-muted">—</span>;
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    [t('orderDetail.ship.courierStatus'), parcel.courierStatusLine ?? dash],
    [
      t('orderDetail.ship.collected'),
      parcel.courierPickedUpAt === null ? dash : fmtDate(parcel.courierPickedUpAt),
    ],
    [
      t('orderDetail.ship.expected'),
      parcel.expectedDeliveryAt === null ? dash : fmtDate(parcel.expectedDeliveryAt),
    ],
    [
      t('orderDetail.ship.chargeable'),
      parcel.chargeableWeightGrams === null ? dash : `${parcel.chargeableWeightGrams} g`,
    ],
    [t('orderDetail.ship.dimensions'), parcel.dimensionsCm ?? dash],
    [
      t('orderDetail.ship.collectable'),
      // PREPAID collects nothing; the em dash is the honest cell.
      parcel.paymentMode === 'COD' && parcel.collectableAmountInr !== null ? (
        <Money amount={parcel.collectableAmountInr} />
      ) : (
        dash
      ),
    ],
  ];
  return (
    <dl className="od-dl">
      {rows.map(([label, value]) => (
        <div key={label} className="od-dl__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
