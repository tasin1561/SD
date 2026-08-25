'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  CardBody,
  ErrorState,
  Ident,
  Input,
  PageHeader,
  ShipmentStatusBadge,
  SkeletonRows,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Toolbar,
  Tr,
  Select,
} from '@skydrop/ui/components';
import type { ShipmentStatus } from '@skydrop/db';
import { useTrackedShipments } from '@/lib/api-hooks';
import { ParcelTimeline } from './parcel-timeline';
import { useTrackedShipment } from '@/lib/api-hooks';

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tracking"
        subtitle="Where your parcels are, and why any of them have not arrived."
      />

      <Toolbar>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {FILTERS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          placeholder="AWB, parcel number or recipient"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Toolbar>

      <Card>
        <CardBody>
          {list.isLoading ? (
            <SkeletonRows rows={6} cols={5} />
          ) : list.isError ? (
            <ErrorState
              message={list.error?.message ?? 'Failed to load.'}
              retry={() => void list.refetch()}
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Parcel</Th>
                  <Th>Going to</Th>
                  <Th>Status</Th>
                  <Th>Last update</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {(list.data?.items ?? []).length === 0 ? (
                  <TableEmpty colSpan={5}>
                    Nothing on its way yet. A parcel appears here once it has been handed to the
                    courier.
                  </TableEmpty>
                ) : (
                  (list.data?.items ?? []).map((r) => (
                    <Tr key={r.shipmentId}>
                      <Td>
                        <Ident value={r.awbNumber ?? r.shipmentNumber} />
                        <div className="text-text-faint text-xs">
                          <Link href={`/orders/${r.orderId}`} className="hover:underline">
                            {r.orderNumber}
                          </Link>{' '}
                          · {r.courierCode}
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
                            <div className="text-text-faint">
                              {new Date(r.lastScanAt).toLocaleString()}
                              {r.lastScanLocation !== null ? ` · ${r.lastScanLocation}` : ''}
                            </div>
                          </>
                        )}
                      </Td>
                      <Td align="right">
                        <button
                          type="button"
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
        </CardBody>
      </Card>

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
    <Card>
      <CardBody>
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
              <span className="text-text-faint ml-2 text-xs">
                {detail.data.courierCode} · {detail.data.recipientName}
              </span>
            </div>
            <ParcelTimeline parcel={detail.data} />
          </>
        )}
      </CardBody>
    </Card>
  );
}
