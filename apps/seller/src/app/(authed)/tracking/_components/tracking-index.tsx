'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ChevronDown, PackageSearch, PackageX, RotateCcw, Search, Truck } from 'lucide-react';
import { Ident } from '@skydrop/ui/components';
import { courierLabel, shipmentStatusKind, statusLabel } from '@skydrop/ui/status';
import type { ShipmentStatus } from '@skydrop/db';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Tabs } from '@skydrop/ui/app/tabs';
import { TextField } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useTrackedShipment, useTrackedShipments } from '@/lib/api-hooks';
import { MetaFact, OrdSection } from '../../orders/_components/orders-parts';
import { ParcelTimeline } from './parcel-timeline';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
/**
 * Every parcel that has left, and where it got to.
 *
 * Only shipments carrying an AWB appear: one without has not been handed
 * to anyone, so it has nothing to track and would sit here forever as
 * "no updates yet".
 *
 * The filters lead with the two states a seller actually comes looking
 * for — a failed delivery and a parcel coming back — because those are
 * the ones that need them to do something.
 *
 * ── WHY THERE ARE NO TOTALS ─────────────────────────────────────────
 * The endpoint returns a WINDOW — one page, capped server-side, with no
 * `total` beside it — and it is already narrowed by whichever status
 * chip is on. So "12 in transit" computed here would be twelve of the
 * hundred we happened to load, of the subset the filter asked for. The
 * tiles therefore read the UNFILTERED view only, and say "of the
 * parcels shown" in their own hint rather than claiming a fleet figure.
 * The alternative — a count endpoint — does not exist, and inventing
 * one out of a page of rows is exactly the reading a seller would act
 * on.
 */
/**
 * The value is a `ShipmentStatus`; the label is what a seller calls it.
 *
 * THIS LIST SAID `DELIVERY_FAILED`, WHICH IS AN ORDER STATUS AND NOT A
 * SHIPMENT ONE. The shipment enum's value is `DELIVERY_ATTEMPTED`, so
 * the tab sent Prisma a value the column cannot hold and the whole
 * screen came back `API 500 (INTERNAL_ERROR)` — on the one filter a
 * seller comes to this page for. The tile below counted the same
 * non-existent value and therefore read 0 for ever, which is the
 * quieter half of the same mistake.
 *
 * Keep the LABEL: "delivery attempted" is the courier's word for it and
 * "delivery failed" is the seller's, and the seller is who is reading.
 */
const filtersOf = (t: Translate<MessageKey>): ReadonlyArray<readonly [string, string]> => [
  ['', t('tracking.allParcels')],
  ['DELIVERY_ATTEMPTED', t('tracking.deliveryFailed')],
  ['RTO_IN_TRANSIT', t('tracking.comingBack2')],
  ['IN_TRANSIT', t('tracking.inTransit')],
  ['OUT_FOR_DELIVERY', t('tracking.outForDelivery')],
  ['DELIVERED', t('tracking.delivered')],
];

export function TrackingIndex(): ReactElement {
  const locale = useLocale();
  const t = useT();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useTrackedShipments({ status, search });

  const rows = list.data?.items ?? [];
  // Only meaningful when nothing is filtering the window. With a status
  // chip on, every row is that status by construction and a breakdown
  // of it is a tautology.
  const unfiltered = status === '' && search.trim() === '';
  const failed = rows.filter((r) => r.status === 'DELIVERY_ATTEMPTED').length;
  const comingBack = rows.filter((r) => r.status.startsWith('RTO_')).length;
  const moving = rows.filter(
    (r) => r.status === 'IN_TRANSIT' || r.status === 'OUT_FOR_DELIVERY',
  ).length;

  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[
          { label: t('tracking.clientConsole') },
          { label: t('tracking.selling') },
          { label: t('tracking.tracking') },
        ]}
        Link={Link}
        title={t('tracking.tracking')}
        subtitle={t('tracking.whereYourParcelsAre')}
        meta={
          list.data === undefined ? undefined : (
            <span className="ord-meta">
              <MetaFact tone="accent">{rows.length} shown</MetaFact>
              {failed > 0 && (
                <MetaFact tone="bad">
                  {richMessage(t('tracking.failedDelivery'), { failed })}
                </MetaFact>
              )}
              {comingBack > 0 && (
                <MetaFact tone="warn">
                  {richMessage(t('tracking.comingBack'), { comingBack })}
                </MetaFact>
              )}
            </span>
          )
        }
      />

      {unfiltered && rows.length > 0 && (
        <div className="ord-kpis">
          <KpiCard
            label={t('tracking.onTheMove')}
            icon={<Truck size={14} />}
            value={moving}
            unit="parcels"
            tone="info"
            hint={t('tracking.inTransitOrOut')}
          />
          <KpiCard
            label={t('tracking.deliveryFailed')}
            icon={<PackageX size={14} />}
            value={failed}
            unit="parcels"
            tone={failed > 0 ? 'debit' : 'neutral'}
            hint={
              failed > 0 ? t('tracking.theCourierTriedAnd') : t('tracking.nothingShownHasFailed')
            }
          />
          <KpiCard
            label={t('tracking.comingBack2')}
            icon={<RotateCcw size={14} />}
            value={comingBack}
            unit="parcels"
            tone={comingBack > 0 ? 'pending' : 'neutral'}
            hint={
              comingBack > 0 ? t('tracking.onTheirWayTo') : t('tracking.nothingShownIsReturning')
            }
          />
        </div>
      )}

      <section className="ord-section">
        <SectionHeading
          title={t('tracking.parcelRegister')}
          note={
            list.data === undefined
              ? undefined
              : `${rows.length} ${rows.length === 1 ? 'parcel' : 'parcels'}`
          }
        />
        <TextField
          label={t('tracking.searchParcels')}
          icon={<Search size={16} />}
          placeholder={t('tracking.awbParcelNumberOr')}
          aria-label={t('tracking.searchParcelsByWaybill')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* Tabs rather than a <select>: six values, and the two a seller
            comes here for are worth being visible without opening
            anything. */}
        <Tabs
          label={t('tracking.filterParcelsByStatus')}
          size="sm"
          items={filtersOf(t).map(([value, label]) => ({
            id: value === '' ? 'all' : value,
            label,
          }))}
          value={status === '' ? 'all' : status}
          onChange={(id) => {
            setStatus(id === 'all' ? '' : id);
            setOpen(null);
          }}
        />

        {list.isLoading ? (
          <SkeletonRows rows={6} cols={5} label={t('tracking.loadingParcels')} />
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message ?? t('tracking.failedToLoad')}
            retry={() => void list.refetch()}
          />
        ) : (
          <div className="ord-card" data-flush="1">
            <Table caption={t('tracking.parcels')}>
              <THead>
                <Tr>
                  <Th>{t('tracking.parcel')}</Th>
                  <Th>{t('tracking.goingTo')}</Th>
                  <Th>{t('tracking.status')}</Th>
                  <Th>{t('tracking.lastUpdate')}</Th>
                  <Th align="right" aria-label={t('tracking.history')} />
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={5}>
                    {status === '' && search.trim() === ''
                      ? t('tracking.nothingOnItsWay')
                      : t('tracking.noParcelMatchesThat')}
                  </TableEmpty>
                ) : (
                  rows.map((r) => (
                    <Tr key={r.shipmentId} selected={open === r.shipmentId}>
                      <Td>
                        <Ident value={r.awbNumber ?? r.shipmentNumber} />
                        <span className="ord-sub">
                          <Link href={`/orders/${r.orderId}`} className="ord-link sk-ident">
                            {r.orderNumber}
                          </Link>{' '}
                          · {courierLabel(r.courierCode, r.manualCourierName)}
                        </span>
                      </Td>
                      <Td>
                        {r.recipientName}
                        {r.recipientCity !== '' && (
                          <span className="ord-sub">{r.recipientCity}</span>
                        )}
                      </Td>
                      <Td>
                        <StatusChip
                          kind={shipmentStatusKind(r.status as ShipmentStatus)}
                          label={statusLabel(r.status as ShipmentStatus, locale)}
                          size="sm"
                        />
                        {r.failedAttempts > 0 && (
                          <span className="ord-sub">
                            {richMessage(t('tracking.failedAttempt'), {
                              failedAttempts: r.failedAttempts,
                              plural: r.failedAttempts === 1 ? '' : 's',
                            })}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {r.lastScanAt === null ? (
                          <span className="ord-faint">{t('tracking.noScansYet')}</span>
                        ) : (
                          <>
                            <div>{r.lastScanDescription ?? r.lastScanStatus}</div>
                            <span className="ord-sub sk-figure">
                              {new Date(r.lastScanAt).toLocaleString()}
                              {r.lastScanLocation !== null ? ` · ${r.lastScanLocation}` : ''}
                            </span>
                          </>
                        )}
                      </Td>
                      <Td align="right">
                        <button
                          type="button"
                          aria-expanded={open === r.shipmentId}
                          className="ord-expand"
                          onClick={() => setOpen(open === r.shipmentId ? null : r.shipmentId)}
                        >
                          {open === r.shipmentId ? t('tracking.hide') : t('tracking.history')}
                          <ChevronDown size={14} aria-hidden />
                        </button>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      {open !== null && <ExpandedParcel shipmentId={open} />}
    </div>
  );
}

/**
 * The full history, fetched only when asked for.
 *
 * A timeline per row on every page load would be one query per parcel to
 * render a line of it — the list already carries the latest scan, which
 * is all the table shows.
 */
function ExpandedParcel({ shipmentId }: { readonly shipmentId: string }): ReactElement {
  const t = useT();
  const detail = useTrackedShipment(shipmentId);
  return (
    <OrdSection
      title={t('tracking.parcelHistory')}
      note={
        detail.data === undefined
          ? undefined
          : `${courierLabel(detail.data.courierCode, detail.data.manualCourierName)} · ${detail.data.recipientName}`
      }
    >
      {detail.isLoading ? (
        <SkeletonRows rows={4} cols={1} label={t('tracking.loadingTheParcelHistory')} />
      ) : detail.isError || detail.data === undefined ? (
        <ErrorState
          message={detail.error?.message ?? t('tracking.failedToLoad')}
          retry={() => void detail.refetch()}
        />
      ) : (
        <ParcelTimeline
          parcel={detail.data}
          header={{
            icon: <PackageSearch size={16} />,
            title: t('tracking.parcel'),
            id: detail.data.awbNumber ?? detail.data.shipmentNumber,
          }}
        />
      )}
    </OrdSection>
  );
}
