'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { OrderSource, OrderStatus } from '@skydrop/db';
import { useOrdersList } from '@/lib/api-hooks';
import {
  Input,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TablePaginator,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  OrderStatusBadge,
} from '@skydrop/ui/components';

/**
 * Order list — URL-driven filter state so a deep-linked filter is
 * shareable + browser back/forward navigates the same filter set.
 * The list itself is fetched via TanStack Query; the URL is the
 * source of truth, the query string is the source of fetch params.
 *
 * Status display uses the shared @skydrop/ui status tokens — every
 * color in the OrderStatusBadge resolves to var(--status-*-*). Never
 * hardcoded hex anywhere on this page (FE-6).
 */

const PAGE_SIZE = 20;
const STATUSES = Object.values(OrderStatus);
const SOURCES = Object.values(OrderSource);

interface QueryParams {
  readonly status: OrderStatus | '';
  readonly source: OrderSource | '';
  readonly search: string;
  readonly page: number;
}

function parseParams(sp: URLSearchParams): QueryParams {
  const status = sp.get('status') as OrderStatus | null;
  const source = sp.get('source') as OrderSource | null;
  return {
    status: status && (STATUSES as string[]).includes(status) ? status : '',
    source: source && (SOURCES as string[]).includes(source) ? source : '',
    search: sp.get('search') ?? '',
    page: Math.max(1, Number(sp.get('page')) || 1),
  };
}

export function OrdersIndex(): ReactElement {
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => parseParams(new URLSearchParams(sp.toString())), [sp]);

  // Local input mirrors the URL for the search box (URL is canonical,
  // but the input feels laggy if we wait for navigation to settle).
  const [searchInput, setSearchInput] = useState(params.search);

  const updateUrl = useCallback(
    (next: Partial<QueryParams>) => {
      const merged: QueryParams = { ...params, ...next };
      const nextSp = new URLSearchParams();
      if (merged.status) nextSp.set('status', merged.status);
      if (merged.source) nextSp.set('source', merged.source);
      if (merged.search) nextSp.set('search', merged.search);
      if (merged.page !== 1) nextSp.set('page', String(merged.page));
      const qs = nextSp.toString();
      router.replace(qs ? `/orders?${qs}` : '/orders');
    },
    [params, router],
  );

  const list = useOrdersList({
    ...(params.status ? { status: params.status } : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(params.search ? { search: params.search } : {}),
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Cross-seller list. Filter by status / source / search; rows link to the order detail."
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateUrl({ search: searchInput.trim(), page: 1 });
          }}
          className="flex items-center gap-2"
        >
          <Input
            placeholder="Order number, ref, recipient name/phone…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-80"
          />
        </form>
        <Select
          value={params.status}
          onChange={(e) =>
            updateUrl({
              status: (e.target.value as OrderStatus | '') || '',
              page: 1,
            })
          }
          className="w-[220px]"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          value={params.source}
          onChange={(e) =>
            updateUrl({
              source: (e.target.value as OrderSource | '') || '',
              page: 1,
            })
          }
          className="w-[160px]"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {(params.status || params.source || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              updateUrl({ status: '', source: '', search: '', page: 1 });
            }}
            className="text-text-faint hover:text-text-body text-xs px-2 py-1 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading orders…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load orders.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No orders match"
          description="Try clearing the filters; new orders surface here as sellers submit."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Order #</Th>
              <Th>Recipient</Th>
              <Th>City</Th>
              <Th>Status</Th>
              <Th>Source</Th>
              <Th align="right">COD (INR)</Th>
              <Th>Placed</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((o) => (
              <Tr key={o.id} onActivate={() => router.push(`/orders/${o.id}`)}>
                <Td>
                  <Link
                    href={`/orders/${o.id}`}
                    className="text-text-bright hover:underline font-mono text-xs"
                  >
                    {o.orderNumber}
                  </Link>
                  {o.sellerOrderRef && (
                    <div className="text-text-faint text-xs mt-0.5 font-mono">
                      ref: {o.sellerOrderRef}
                    </div>
                  )}
                </Td>
                <Td>
                  <div className="text-text-body">{o.recipientName}</div>
                </Td>
                <Td className="text-text-muted">
                  {/* Empty for orders placed since the seller form stopped
                      asking — Delhivery resolves the locality from the PIN.
                      Join only what exists so a row is not a bare comma. */}
                  {[o.recipientCity, o.recipientStateProvince].filter(Boolean).join(', ') || '—'}
                </Td>
                <Td>
                  <OrderStatusBadge status={o.status} />
                </Td>
                <Td>
                  <span className="text-text-muted text-xs uppercase">{o.source}</span>
                </Td>
                <Td align="right">
                  <span className="text-text-body font-mono text-xs">{o.codAmountInr ?? '—'}</span>
                </Td>
                <Td className="text-text-muted text-xs font-mono">
                  {new Date(o.placedAt).toISOString().slice(0, 16).replace('T', ' ')}
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr>
              <td colSpan={7} className="p-0">
                <TablePaginator
                  page={params.page}
                  pageSize={PAGE_SIZE}
                  total={list.data.total}
                  onPageChange={(next) => updateUrl({ page: next })}
                />
              </td>
            </tr>
          </tfoot>
        </Table>
      )}
    </div>
  );
}
