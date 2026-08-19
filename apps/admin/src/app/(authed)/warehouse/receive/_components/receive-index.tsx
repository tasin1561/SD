'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { GoodsReceiptStatus } from '@skydrop/db';
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
import { useGoodsReceiptsList, useSellersList, useWarehouses } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { useRouter } from 'next/navigation';

const PAGE_SIZE = 20;
const STATUSES: ReadonlyArray<GoodsReceiptStatus> = [
  'PENDING',
  'ARRIVING',
  'COMPLETED',
  'DISCREPANCY',
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
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as GoodsReceiptStatus | '');
            setPage(1);
          }}
          className="max-w-[180px]"
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
            value={sellerId}
            aria-label="Filter by seller"
            onChange={(e) => {
              setSellerId(e.target.value);
              setPage(1);
            }}
            className="max-w-[220px]"
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
          value={warehouseId}
          aria-label="Filter by warehouse"
          onChange={(e) => {
            setWarehouseId(e.target.value);
            setPage(1);
          }}
          className="max-w-[200px]"
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
        <LoadingState label="Loading goods receipts…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No goods receipts match"
          description="Sellers declare expected stock via /seller/goods-receipts before shipping. Once they do, those receipts appear here for the warehouse team to receive."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Receipt</Th>
              <Th>Seller</Th>
              <Th>Status</Th>
              <Th className="text-right">Products</Th>
              <Th>Declared</Th>
              <Th>Last update</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((r) => (
              <Tr key={r.id} onActivate={() => router.push(`/warehouse/receive/${r.id}`)}>
                <Td className="font-mono text-xs">
                  <Link
                    href={`/warehouse/receive/${r.id}`}
                    className="text-text-bright hover:underline"
                  >
                    {r.receiptNumber}
                  </Link>
                </Td>
                <Td>{r.seller.companyName}</Td>
                <Td className="text-text-muted text-xs uppercase">{r.status}</Td>
                <Td className="text-right font-mono">{r.lines.length}</Td>
                <Td className="text-text-faint text-xs font-mono">
                  {new Date(r.createdAt).toISOString().slice(0, 10)}
                </Td>
                <Td className="text-text-faint text-xs font-mono">
                  {new Date(r.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}
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
