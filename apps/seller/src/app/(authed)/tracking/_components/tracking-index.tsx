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
const FILTERS: ReadonlyArray<readonly [string, string]> = [
  ['', 'All parcels'],
  ['DELIVERY_FAILED', 'Delivery failed'],
  ['RTO_IN_TRANSIT', 'Coming back'],
  ['IN_TRANSIT', 'In transit'],
  ['OUT_FOR_DELIVERY', 'Out for delivery'],
  ['DELIVERED', 'Delivered'],
];

export function TrackingIndex(): ReactElement {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useTrackedShipments({ status, search });

  const rows = list.data?.items ?? [];
  // Only meaningful when nothing is filtering the window. With a status
  // chip on, every row is that status by construction and a breakdown
  // of it is a tautology.
  const unfiltered = status === '' && search.trim() === '';
  const failed = rows.filter((r) => r.status === 'DELIVERY_FAILED').length;
  const comingBack = rows.filter((r) => r.status.startsWith('RTO_')).length;
  const moving = rows.filter(
    (r) => r.status === 'IN_TRANSIT' || r.status === 'OUT_FOR_DELIVERY',
  ).length;

  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Selling' }, { label: 'Tracking' }]}
        Link={Link}
        title="Tracking"
        subtitle="Where your parcels are, and why any of them have not arrived."
        meta={
          list.data === undefined ? undefined : (
            <span className="ord-meta">
              <MetaFact tone="accent">{rows.length} shown</MetaFact>
              {failed > 0 && <MetaFact tone="bad">{failed} failed delivery</MetaFact>}
              {comingBack > 0 && <MetaFact tone="warn">{comingBack} coming back</MetaFact>}
            </span>
          )
        }
      />

      {unfiltered && rows.length > 0 && (
        <div className="ord-kpis">
          <KpiCard
            label="On the move"
            icon={<Truck size={14} />}
            value={moving}
            unit="parcels"
            tone="info"
            hint="In transit or out for delivery, of the parcels shown."
          />
          <KpiCard
            label="Delivery failed"
            icon={<PackageX size={14} />}
            value={failed}
            unit="parcels"
            tone={failed > 0 ? 'debit' : 'neutral'}
            hint={
              failed > 0
                ? 'The courier tried and could not hand it over.'
                : 'Nothing shown has failed a delivery.'
            }
          />
          <KpiCard
            label="Coming back"
            icon={<RotateCcw size={14} />}
            value={comingBack}
            unit="parcels"
            tone={comingBack > 0 ? 'pending' : 'neutral'}
            hint={
              comingBack > 0
                ? 'On their way to our warehouse. You pay the leg home.'
                : 'Nothing shown is returning.'
            }
          />
        </div>
      )}

      <section className="ord-section">
        <SectionHeading
          title="Parcel register"
          note={
            list.data === undefined
              ? undefined
              : `${rows.length} ${rows.length === 1 ? 'parcel' : 'parcels'}`
          }
        />
        <TextField
          label="Search parcels"
          icon={<Search size={16} />}
          placeholder="AWB, parcel number or recipient…"
          aria-label="Search parcels by waybill, number or recipient"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* Tabs rather than a <select>: six values, and the two a seller
            comes here for are worth being visible without opening
            anything. */}
        <Tabs
          label="Filter parcels by status"
          size="sm"
          items={FILTERS.map(([value, label]) => ({ id: value === '' ? 'all' : value, label }))}
          value={status === '' ? 'all' : status}
          onChange={(id) => {
            setStatus(id === 'all' ? '' : id);
            setOpen(null);
          }}
        />

        {list.isLoading ? (
          <SkeletonRows rows={6} cols={5} label="Loading parcels…" />
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message ?? 'Failed to load.'}
            retry={() => void list.refetch()}
          />
        ) : (
          <div className="ord-card" data-flush="1">
            <Table caption="Parcels">
              <THead>
                <Tr>
                  <Th>Parcel</Th>
                  <Th>Going to</Th>
                  <Th>Status</Th>
                  <Th>Last update</Th>
                  <Th align="right" aria-label="History" />
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={5}>
                    {status === '' && search.trim() === ''
                      ? 'Nothing on its way yet. A parcel appears here once it has been handed to the courier.'
                      : 'No parcel matches that. Try another filter, or clear the search.'}
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
                          label={statusLabel(r.status as ShipmentStatus)}
                          size="sm"
                        />
                        {r.failedAttempts > 0 && (
                          <span className="ord-sub">
                            {r.failedAttempts} failed attempt
                            {r.failedAttempts === 1 ? '' : 's'}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {r.lastScanAt === null ? (
                          <span className="ord-faint">No scans yet</span>
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
                          {open === r.shipmentId ? 'Hide' : 'History'}
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
  const detail = useTrackedShipment(shipmentId);
  return (
    <OrdSection
      title="Parcel history"
      note={
        detail.data === undefined
          ? undefined
          : `${courierLabel(detail.data.courierCode, detail.data.manualCourierName)} · ${detail.data.recipientName}`
      }
    >
      {detail.isLoading ? (
        <SkeletonRows rows={4} cols={1} label="Loading the parcel history…" />
      ) : detail.isError || detail.data === undefined ? (
        <ErrorState
          message={detail.error?.message ?? 'Failed to load.'}
          retry={() => void detail.refetch()}
        />
      ) : (
        <ParcelTimeline
          parcel={detail.data}
          header={{
            icon: <PackageSearch size={16} />,
            title: 'Parcel',
            id: detail.data.awbNumber ?? detail.data.shipmentNumber,
          }}
        />
      )}
    </OrdSection>
  );
}
