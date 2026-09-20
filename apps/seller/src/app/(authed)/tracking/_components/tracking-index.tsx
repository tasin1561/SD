'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { PackageX, RotateCcw, Truck } from 'lucide-react';
import {
  BandBody,
  Crumbs,
  ErrorState,
  FilterChip,
  Ident,
  Input,
  MetaChip,
  PageHeader,
  SectionBand,
  ShipmentStatusBadge,
  SkeletonRows,
  Stat,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { courierLabel } from '@skydrop/ui/status';
import type { ShipmentStatus } from '@skydrop/db';
import { useTrackedShipment, useTrackedShipments } from '@/lib/api-hooks';
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
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[{ label: 'Seller console' }, { label: 'Selling' }, { label: 'Tracking' }]}
            Link={Link}
          />
        }
        title="Tracking"
        subtitle="Where your parcels are, and why any of them have not arrived."
        meta={
          list.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">{rows.length} shown</MetaChip>
              {failed > 0 && <MetaChip tone="bad">{failed} failed delivery</MetaChip>}
              {comingBack > 0 && <MetaChip tone="warn">{comingBack} coming back</MetaChip>}
            </>
          )
        }
      />

      {unfiltered && rows.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="On the move"
            icon={<Truck size={13} aria-hidden />}
            value={moving}
            unit="parcels"
            tone="neutral"
            hint="In transit or out for delivery, of the parcels shown."
          />
          <Stat
            label="Delivery failed"
            icon={<PackageX size={13} aria-hidden />}
            value={failed}
            unit="parcels"
            tone={failed > 0 ? 'bad' : 'neutral'}
            hint={
              failed > 0
                ? 'The courier tried and could not hand it over.'
                : 'Nothing shown has failed a delivery.'
            }
          />
          <Stat
            label="Coming back"
            icon={<RotateCcw size={13} aria-hidden />}
            value={comingBack}
            unit="parcels"
            tone={comingBack > 0 ? 'warn' : 'neutral'}
            hint={
              comingBack > 0
                ? 'On their way to our warehouse. You pay the leg home.'
                : 'Nothing shown is returning.'
            }
          />
        </div>
      )}

      <SectionBand
        index="01"
        title="Parcel register"
        note={
          list.data === undefined
            ? undefined
            : `${rows.length} ${rows.length === 1 ? 'parcel' : 'parcels'}`
        }
        action={
          <Input
            placeholder="AWB, parcel number or recipient…"
            aria-label="Search parcels by waybill, number or recipient"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
        }
      />

      <BandBody flush>
        {/* Chips rather than a <select>: six values, and the two a seller
            comes here for are worth being visible without opening
            anything. */}
        <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-3 py-2.5">
          {FILTERS.map(([value, label]) => (
            <FilterChip
              key={value === '' ? 'all' : value}
              label={label}
              active={status === value}
              onClick={() => {
                setStatus(value);
                setOpen(null);
              }}
            />
          ))}
        </div>

        {list.isLoading ? (
          <div className="p-3">
            <SkeletonRows rows={6} cols={5} />
          </div>
        ) : list.isError ? (
          <div className="p-3">
            <ErrorState
              message={list.error?.message ?? 'Failed to load.'}
              retry={() => void list.refetch()}
            />
          </div>
        ) : (
          <Table>
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
                  <Tr key={r.shipmentId}>
                    <Td>
                      <Ident value={r.awbNumber ?? r.shipmentNumber} />
                      <div className="text-text-faint mt-0.5 text-xs">
                        <Link
                          href={`/orders/${r.orderId}`}
                          className="text-accent font-mono hover:underline"
                        >
                          {r.orderNumber}
                        </Link>{' '}
                        · {courierLabel(r.courierCode, r.manualCourierName)}
                      </div>
                    </Td>
                    <Td className="text-text-body text-sm">
                      {r.recipientName}
                      {r.recipientCity !== '' && (
                        <div className="text-text-faint text-xs">{r.recipientCity}</div>
                      )}
                    </Td>
                    <Td>
                      <ShipmentStatusBadge status={r.status as ShipmentStatus} />
                      {r.failedAttempts > 0 && (
                        <div className="text-text-faint mt-0.5 text-xs">
                          {r.failedAttempts} failed attempt
                          {r.failedAttempts === 1 ? '' : 's'}
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {r.lastScanAt === null ? (
                        <span className="text-text-faint">No scans yet</span>
                      ) : (
                        <>
                          <div className="text-text-body">
                            {r.lastScanDescription ?? r.lastScanStatus}
                          </div>
                          <div className="text-text-faint font-mono">
                            {new Date(r.lastScanAt).toLocaleString()}
                            {r.lastScanLocation !== null ? ` · ${r.lastScanLocation}` : ''}
                          </div>
                        </>
                      )}
                    </Td>
                    <Td align="right">
                      <button
                        type="button"
                        aria-expanded={open === r.shipmentId}
                        className="text-accent min-h-[32px] text-xs underline"
                        onClick={() => setOpen(open === r.shipmentId ? null : r.shipmentId)}
                      >
                        {open === r.shipmentId ? 'Hide' : 'History'}
                      </button>
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </BandBody>

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
    <div className="mt-4">
      <SectionBand
        index="02"
        title="Parcel history"
        note={
          detail.data === undefined
            ? undefined
            : `${courierLabel(detail.data.courierCode, detail.data.manualCourierName)} · ${detail.data.recipientName}`
        }
      />
      <BandBody>
        {detail.isLoading ? (
          <SkeletonRows rows={4} cols={1} />
        ) : detail.isError || detail.data === undefined ? (
          <ErrorState
            message={detail.error?.message ?? 'Failed to load.'}
            retry={() => void detail.refetch()}
          />
        ) : (
          <>
            <div className="mb-3">
              <Ident value={detail.data.awbNumber ?? detail.data.shipmentNumber} />
            </div>
            <ParcelTimeline parcel={detail.data} />
          </>
        )}
      </BandBody>
    </div>
  );
}
