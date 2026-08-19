'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, type ReactElement } from 'react';
import { useStockList, useStockSummary } from '@/lib/api-hooks';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TablePaginator,
} from '@skydrop/ui/components';

const PAGE_SIZE = 25;

/**
 * Cross-warehouse inventory roll-up for the seller. Read-only: the
 * "receive stock" action lives in the warehouse-ops admin UI (staff
 * scan the incoming parcel and log the receipt). The seller view
 * exposes:
 *   - On-hand / reserved / available qty per variant
 *   - The seller's effective low-stock threshold (variant override →
 *     seller default → null)
 *   - Warehouse footprint count (Phase 1A always 1 — BLR-01)
 *
 * Out of scope (Phase 1A): per-warehouse breakdown rows, batch / bin
 * detail, stock-movements history.
 */
export function InventoryView(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageParam = Number(searchParams?.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const list = useStockList({ page, pageSize: PAGE_SIZE });
  const summary = useStockSummary();

  const updateUrl = useCallback(
    (nextPage: number) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? '');
      if (nextPage === 1) sp.delete('page');
      else sp.set('page', String(nextPage));
      const qs = sp.toString();
      router.push(`/inventory${qs ? `?${qs}` : ''}`);
    },
    [router, searchParams],
  );

  const cards = useMemo(() => {
    if (!summary.data) return null;
    const s = summary.data;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <SummaryCard label="SKUs" value={s.totalSkus.toLocaleString()} />
        <SummaryCard label="On hand" value={s.totalQtyOnHand.toLocaleString()} />
        <SummaryCard
          label="Available"
          value={s.totalQtyAvailable.toLocaleString()}
          hint={`${s.totalQtyReserved.toLocaleString()} reserved`}
        />
        <SummaryCard
          label="Low stock"
          value={s.lowStockSkus.toLocaleString()}
          tone={s.lowStockSkus > 0 ? 'warn' : 'default'}
        />
      </div>
    );
  }, [summary.data]);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock available for orders. Receiving happens at the warehouse — speak to ops to add inventory."
        action={
          <Link href="/inventory/units" className="text-accent text-sm hover:underline">
            Unit discrepancies →
          </Link>
        }
      />

      {cards}

      {list.isLoading ? (
        <LoadingState label="Loading inventory…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load inventory.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No stock yet"
          description="Once your shipment is received at our Indian warehouse, your variants will show up here with on-hand qty."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>SKU</Th>
              <Th>Variant</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Reserved</Th>
              <Th className="text-right">Available</Th>
              <Th className="text-right">Low-stock</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((row) => (
              <Tr
                key={row.variantId}
                onActivate={() =>
                  router.push(`/products/${row.productId}/variants/${row.variantId}`)
                }
              >
                <Td className="font-mono text-xs">
                  <Link
                    href={`/products/${row.productId}/variants/${row.variantId}`}
                    className="text-text-bright hover:underline"
                  >
                    {row.skuCode}
                  </Link>
                </Td>
                <Td className="text-text-muted text-xs">{row.variantLabel ?? '—'}</Td>
                <Td className="text-right font-mono">{row.qtyOnHand.toLocaleString()}</Td>
                <Td className="text-right font-mono text-text-muted">
                  {row.qtyReserved.toLocaleString()}
                </Td>
                <Td className="text-right font-mono">
                  <span
                    className={row.isLowStock ? 'text-critical font-medium' : 'text-text-bright'}
                  >
                    {row.qtyAvailable.toLocaleString()}
                  </span>
                </Td>
                <Td className="text-right text-text-muted text-xs">
                  {row.lowStockThreshold !== null ? row.lowStockThreshold.toLocaleString() : '—'}
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
                  onPageChange={updateUrl}
                />
              </td>
            </tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly tone?: 'default' | 'warn';
}): ReactElement {
  return (
    <Card>
      <CardBody className="py-3">
        <div className="text-text-faint text-xs uppercase tracking-wide">{label}</div>
        <div
          className={
            'text-xl font-semibold tracking-tight mt-0.5 ' +
            (tone === 'warn' ? 'text-critical' : 'text-text-bright')
          }
        >
          {value}
        </div>
        {hint && <div className="text-text-faint text-xs mt-0.5">{hint}</div>}
      </CardBody>
    </Card>
  );
}
