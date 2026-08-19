'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { OrderStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { usePendingRows, useOrdersList } from '@/lib/api-hooks';
import { canSeePath } from '@/lib/page-access';
import { Plus } from 'lucide-react';
import {
  Button,
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
 * Seller order list — URL-driven filter state so a deep-linked filter
 * is shareable + browser back/forward navigates the same set. The
 * list itself is fetched via TanStack Query; the URL is canonical,
 * the query string is the fetch params.
 *
 * Mirrors apps/admin/src/app/(authed)/orders/_components/orders-index
 * with seller-scoped tweaks: no source filter (sellers know their own
 * sources), no seller column (it's all theirs), search + status only.
 * The shared @skydrop/ui status tokens drive every color (FE-6).
 */

const PAGE_SIZE = 20;
const STATUSES = Object.values(OrderStatus);

interface QueryParams {
  readonly status: OrderStatus | '';
  readonly search: string;
  readonly page: number;
}

function parseParams(sp: URLSearchParams): QueryParams {
  const status = sp.get('status') as OrderStatus | null;
  return {
    status: status && (STATUSES as string[]).includes(status) ? status : '',
    search: sp.get('search') ?? '',
    page: Math.max(1, Number(sp.get('page')) || 1),
  };
}

export function OrdersIndex(): ReactElement {
  const identity = useSellerIdentity();
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => parseParams(new URLSearchParams(sp.toString())), [sp]);

  const [searchInput, setSearchInput] = useState(params.search);
  const pendingCount = usePendingRows().data?.length ?? 0;

  const updateUrl = useCallback(
    (next: Partial<QueryParams>) => {
      const merged: QueryParams = { ...params, ...next };
      const nextSp = new URLSearchParams();
      if (merged.status) nextSp.set('status', merged.status);
      if (merged.search) nextSp.set('search', merged.search);
      if (merged.page !== 1) nextSp.set('page', String(merged.page));
      const qs = nextSp.toString();
      router.replace(qs ? `/orders?${qs}` : '/orders');
    },
    [params, router],
  );

  const list = useOrdersList({
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Your orders. Filter by status / search; rows link to detail + tracking."
        action={
          <div className="flex items-center gap-2">
            {/* Only when there IS something waiting. A permanent nav
                item for an empty queue is noise; a queue nobody knows
                about is worse than both. */}
            {pendingCount > 0 && canSeePath(identity, '/orders/pending') && (
              <Link href="/orders/pending">
                <Button variant="ghost" size="md">
                  <span className="text-[var(--status-pending-fg)]">{pendingCount} pending</span>
                </Button>
              </Link>
            )}
            {canSeePath(identity, '/orders/import') && (
              <Link href="/orders/import">
                <Button variant="ghost" size="md">
                  CSV import
                </Button>
              </Link>
            )}
            {canSeePath(identity, '/orders/new') && (
              <Link href="/orders/new">
                <Button variant="primary" size="md">
                  <Plus size={14} /> New order
                </Button>
              </Link>
            )}
          </div>
        }
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
        {(params.status || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              updateUrl({ status: '', search: '', page: 1 });
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
          description="Try clearing the filters; new orders surface here as you create them or your CSVs import."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Order #</Th>
              <Th>Recipient</Th>
              <Th>Phone</Th>
              <Th>Status</Th>
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
                <Td className="text-text-muted font-mono text-xs">
                  {/* Was City, which is blank on every order placed since
                      the form stopped asking for it (ORD-5: Delhivery
                      resolves the locality from the PIN) — a column of
                      dashes. The phone is what identifies a recipient
                      here, and it is what the search box matches on. */}
                  {o.recipientPhoneE164 || '—'}
                </Td>
                <Td>
                  <OrderStatusBadge status={o.status} />
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
              <td colSpan={6} className="p-0">
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
