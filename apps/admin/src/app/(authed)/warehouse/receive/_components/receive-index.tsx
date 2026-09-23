'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { GoodsReceiptStatus } from '@skydrop/db';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { useGoodsReceiptsList, useSellersList, useWarehouses } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { useRouter } from 'next/navigation';
import '../../_components/benches.css';

const PAGE_SIZE = 20;
// No DISCREPANCY. Nothing writes that status any more (CNS-3): a count
// variance completes and is recorded on the receipt, so the filter would
// only ever return the empty set and read as "none of these have a
// problem" — the opposite of the truth.
const STATUSES: ReadonlyArray<GoodsReceiptStatus> = [
  'PENDING',
  'ARRIVING',
  'COMPLETED',
  'CANCELLED',
] as GoodsReceiptStatus[];

export function ReceiveIndex(): ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState<GoodsReceiptStatus | ''>('PENDING');
  const [sellerId, setSellerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);

  /**
   * The seller list needs `sellers.view`; this page needs
   * `warehouse.view`. They are different permissions, so a warehouse
   * account may well have one and not the other — the hook self-gates
   * and the control is hidden rather than shown empty, which would read
   * as "no sellers exist".
   */
  const maySeeSellers = usePermission('sellers.view');
  const sellers = useSellersList({ page: 1, pageSize: 100 });
  const warehouses = useWarehouses();

  const list = useGoodsReceiptsList({
    ...(status ? { status: status as GoodsReceiptStatus } : {}),
    ...(sellerId === '' ? {} : { sellerId }),
    ...(warehouseId === '' ? {} : { warehouseId }),
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="wh-stack">
      <div className="wh-fields wh-filters">
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as GoodsReceiptStatus | '');
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        {maySeeSellers && (
          <Select
            label="Seller"
            value={sellerId}
            aria-label="Filter by seller"
            onChange={(e) => {
              setSellerId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All sellers</option>
            {(sellers.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>
        )}

        <Select
          label="Warehouse"
          value={warehouseId}
          aria-label="Filter by warehouse"
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All warehouses</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <section className="wh-card">
          <SkeletonRows rows={6} cols={7} label="Loading goods receipts…" />
        </section>
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No goods receipts match"
          description="Sellers declare stock as a consignment from Inbound in their portal before shipping. Once it arrives, its goods receipt appears here for the warehouse team to count."
        />
      ) : (
        <div className="wh-stack">
          <Table caption="Goods receipts">
            <THead>
              <Tr>
                <Th>Receipt</Th>
                <Th>Consignment</Th>
                <Th>Seller</Th>
                <Th>Status</Th>
                <Th align="right">Products</Th>
                <Th>Declared</Th>
                <Th>Last update</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.items.map((r) => (
                <Tr key={r.id} onActivate={() => router.push(`/warehouse/receive/${r.id}`)}>
                  <Td>
                    <Link href={`/warehouse/receive/${r.id}`} className="sk-ident wh-cell-link">
                      {r.receiptNumber}
                    </Link>
                  </Td>
                  {/*
                    A leg of a consignment says so, and links back to it.
                    Without this the queue showed a bare GR- number and an
                    operator had no way to tell it was the same thing as the
                    consignment open in another tab — two lists of one
                    parcel with nothing joining them.
                  */}
                  <Td>
                    {r.consignment === null ? (
                      <span className="wh-faint">—</span>
                    ) : (
                      <Link
                        href={`/warehouse/consignments/${r.consignment.id}`}
                        className="sk-ident wh-link"
                      >
                        {r.consignment.consignmentNumber}
                      </Link>
                    )}
                  </Td>
                  <Td>{r.seller.companyName}</Td>
                  <Td>
                    <StatusChip kind="neutral" label={r.status} size="sm" />
                  </Td>
                  <Td align="right" className="sk-figure">
                    {r.lines.length}
                  </Td>
                  <Td className="sk-figure wh-faint">
                    {new Date(r.createdAt).toISOString().slice(0, 10)}
                  </Td>
                  <Td className="sk-figure wh-faint">
                    {new Date(r.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data.total}
            onPageChange={setPage}
            label="Goods receipts pages"
          />
        </div>
      )}
    </div>
  );
}
