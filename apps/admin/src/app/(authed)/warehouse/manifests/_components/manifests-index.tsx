'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ManifestStatus } from '@skydrop/db';
import { useManifestsList } from '@/lib/api-hooks';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useRouter } from 'next/navigation';
import { PanelPad, Stack, Toolbar } from '../../../inventory/_components/stock-kit';

const PAGE_SIZE = 25;

export function ManifestsIndex(): ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState<ManifestStatus | ''>('');
  const [page, setPage] = useState(1);

  const list = useManifestsList({
    ...(status ? { status: status as ManifestStatus } : {}),
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <Stack>
      <Toolbar>
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ManifestStatus | '');
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="CLOSED">CLOSED</option>
          <option value="AWB_PENDING">AWB_PENDING</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="DISPATCHED">DISPATCHED</option>
          <option value="FAILED">FAILED</option>
        </Select>
      </Toolbar>

      {list.isLoading ? (
        <SkeletonRows rows={6} cols={6} label="Loading manifests…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load manifests.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No manifests yet"
          description="A DRAFT manifest is auto-created when the first shipment is packed for a (courier, warehouse) pair."
        />
      ) : (
        <>
          <Table>
            <THead>
              <Tr>
                <Th>Manifest</Th>
                <Th>Status</Th>
                <Th>Courier</Th>
                <Th align="right">Shipments</Th>
                <Th>Created</Th>
                <Th>Closed</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.items.map((m) => (
                <Tr key={m.id} onActivate={() => router.push(`/warehouse/manifests/${m.id}`)}>
                  <Td>
                    <Link href={`/warehouse/manifests/${m.id}`} className="stk-link sk-ident">
                      {m.manifestNumber}
                    </Link>
                  </Td>
                  <Td>
                    <StatusChip size="sm" kind="neutral" label={m.status.replace(/_/g, ' ')} />
                  </Td>
                  <Td className="stk-muted">{m.courierCode}</Td>
                  <Td align="right" className="sk-figure">
                    {m.shipmentCount}
                  </Td>
                  <Td className="stk-muted sk-figure stk-nowrap">
                    {new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </Td>
                  <Td className="stk-muted sk-figure stk-nowrap">
                    {m.closedAt
                      ? new Date(m.closedAt).toISOString().slice(0, 16).replace('T', ' ')
                      : '—'}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <PanelPad>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data.total}
              onPageChange={setPage}
            />
          </PanelPad>
        </>
      )}
    </Stack>
  );
}
