'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ManifestStatus } from '@skydrop/db';
import { useManifestsList } from '@/lib/api-hooks';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TablePaginator,
} from '@skydrop/ui/components';

const PAGE_SIZE = 25;

export function ManifestsIndex(): ReactElement {
  const [status, setStatus] = useState<ManifestStatus | ''>('');
  const [page, setPage] = useState(1);

  const list = useManifestsList({
    ...(status ? { status: status as ManifestStatus } : {}),
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ManifestStatus | '');
            setPage(1);
          }}
          className="max-w-[200px]"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="CLOSED">CLOSED</option>
          <option value="AWB_PENDING">AWB_PENDING</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="DISPATCHED">DISPATCHED</option>
          <option value="FAILED">FAILED</option>
        </Select>
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading manifests…" />
      ) : list.isError ? (
        <ErrorState message={list.error?.message ?? 'Failed to load manifests.'} />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No manifests yet"
          description="A DRAFT manifest is auto-created when the first shipment is packed for a (courier, warehouse) pair."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Manifest</Th>
              <Th>Status</Th>
              <Th>Courier</Th>
              <Th className="text-right">Shipments</Th>
              <Th>Created</Th>
              <Th>Closed</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((m) => (
              <Tr key={m.id} interactive>
                <Td>
                  <Link
                    href={`/warehouse/manifests/${m.id}`}
                    className="text-text-bright font-mono text-xs hover:underline"
                  >
                    {m.manifestNumber}
                  </Link>
                </Td>
                <Td>
                  <span className="text-text-bright text-xs uppercase tracking-wide">
                    {m.status}
                  </span>
                </Td>
                <Td className="text-text-muted">{m.courierCode}</Td>
                <Td className="text-right font-mono">{m.shipmentCount}</Td>
                <Td className="text-text-muted text-xs font-mono">
                  {new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                </Td>
                <Td className="text-text-muted text-xs font-mono">
                  {m.closedAt
                    ? new Date(m.closedAt).toISOString().slice(0, 16).replace('T', ' ')
                    : '—'}
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr>
              <td colSpan={6} className="p-0">
                <TablePaginator
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={list.data.total}
                  onPageChange={setPage}
                />
              </td>
            </tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}
