'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { OrderSource, OrderStatus } from '@skydrop/db';
import { useOrdersList, useSellersList } from '@/lib/api-hooks';
import { istDayRange } from '@/lib/ist-day';
import { Package, Search } from 'lucide-react';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { chipWords, StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { MetaFact, OoCard } from './order-ops-parts';
import './order-core.css';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Order list — URL-driven filter state so a deep-linked filter is
 * shareable + browser back/forward navigates the same filter set.
 * The list itself is fetched via TanStack Query; the URL is the
 * source of truth, the query string is the source of fetch params.
 *
 * The date filters are INDIAN days (lib/ist-day): "placed on the 1st"
 * means midnight to midnight in India, whatever zone the reader is in.
 * The API compares `placedTo` inclusively, so the upper bound sent is
 * the last millisecond of the chosen day rather than the next midnight.
 *
 * Status display uses the shared @skydrop/ui status tokens — every
 * color in the OrderStatusBadge resolves to var(--status-*-*). Never
 * hardcoded hex anywhere on this page (FE-6).
 */

const PAGE_SIZE = 20;
const STATUSES = Object.values(OrderStatus);
const SOURCES = Object.values(OrderSource);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface QueryParams {
  readonly status: OrderStatus | '';
  readonly source: OrderSource | '';
  readonly search: string;
  readonly sellerId: string;
  /** IST calendar day, YYYY-MM-DD, or ''. */
  readonly from: string;
  readonly to: string;
  readonly page: number;
}

function parseParams(sp: URLSearchParams): QueryParams {
  const status = sp.get('status') as OrderStatus | null;
  const source = sp.get('source') as OrderSource | null;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  return {
    status: status && (STATUSES as string[]).includes(status) ? status : '',
    source: source && (SOURCES as string[]).includes(source) ? source : '',
    search: sp.get('search') ?? '',
    sellerId: sp.get('sellerId') ?? '',
    from: DAY.test(from) ? from : '',
    to: DAY.test(to) ? to : '',
    page: Math.max(1, Number(sp.get('page')) || 1),
  };
}

export function OrdersIndex(): ReactElement {
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => parseParams(new URLSearchParams(sp.toString())), [sp]);
  const sellers = useSellersList({ page: 1, pageSize: 100 });

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
      if (merged.sellerId) nextSp.set('sellerId', merged.sellerId);
      if (merged.from) nextSp.set('from', merged.from);
      if (merged.to) nextSp.set('to', merged.to);
      if (merged.page !== 1) nextSp.set('page', String(merged.page));
      const qs = nextSp.toString();
      router.replace(qs ? `/orders?${qs}` : '/orders');
    },
    [params, router],
  );

  const placedFrom = params.from === '' ? undefined : istDayRange(params.from, params.from).from;
  const placedTo =
    params.to === ''
      ? undefined
      : new Date(new Date(istDayRange(params.to, params.to).to).getTime() - 1).toISOString();

  const list = useOrdersList({
    ...(params.status ? { status: params.status } : {}),
    ...(params.source ? { source: params.source } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.sellerId ? { sellerId: params.sellerId } : {}),
    ...(placedFrom === undefined ? {} : { placedFrom }),
    ...(placedTo === undefined ? {} : { placedTo }),
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  const sellerOptions = sellers.data?.items ?? [];
  // A deep link from seller detail can name a seller beyond the first
  // hundred; keep the filter visible rather than showing "All sellers"
  // while the list is in fact narrowed.
  const sellerMissing =
    params.sellerId !== '' && !sellerOptions.some((s) => s.id === params.sellerId);
  const filtered =
    params.status || params.source || params.search || params.sellerId || params.from || params.to;

  const activeFilters = [
    params.status,
    params.source,
    params.search,
    params.sellerId,
    params.from,
    params.to,
  ].filter((v) => v !== '').length;

  return (
    <div className="oo-page">
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Orders' }]}
        Link={Link}
        title="Orders"
        subtitle="Cross-seller list. Filter by status, source, seller, the day it was placed (India time) or search; rows link to the order detail."
        meta={
          list.data === undefined ? undefined : (
            <span className="oo-meta">
              <MetaFact tone="accent">{list.data.total} orders</MetaFact>
              {filtered && <MetaFact>Filtered</MetaFact>}
            </span>
          )
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onReset={() => {
          setSearchInput('');
          updateUrl({
            status: '',
            source: '',
            search: '',
            sellerId: '',
            from: '',
            to: '',
            page: 1,
          });
        }}
      >
        <FilterField wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateUrl({ search: searchInput.trim(), page: 1 });
            }}
          >
            <TextField
              label="Search"
              placeholder="Order number, ref, recipient name/phone…"
              aria-label="Search orders"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              trail={
                <button type="submit" aria-label="Search" title="Search" className="oo-search-btn">
                  <Search size={16} aria-hidden />
                </button>
              }
            />
          </form>
        </FilterField>
        <FilterField>
          <Select
            label="Status"
            aria-label="Status"
            value={params.status}
            onChange={(e) =>
              updateUrl({
                status: (e.target.value as OrderStatus | '') || '',
                page: 1,
              })
            }
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {chipWords(statusLabel(s))}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField>
          <Select
            label="Source"
            aria-label="Source"
            value={params.source}
            onChange={(e) =>
              updateUrl({
                source: (e.target.value as OrderSource | '') || '',
                page: 1,
              })
            }
          >
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {chipWords(s.replace(/_/g, ' '))}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField>
          <Select
            label="Seller"
            aria-label="Seller"
            value={params.sellerId}
            onChange={(e) => updateUrl({ sellerId: e.target.value, page: 1 })}
          >
            <option value="">All sellers</option>
            {sellerMissing && <option value={params.sellerId}>This seller</option>}
            {sellerOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField wide>
          <div className="oc-dates">
            <DateField
              label="Placed from"
              value={params.from}
              max={params.to || undefined}
              onChange={(e) => updateUrl({ from: e.target.value, page: 1 })}
            />
            <DateField
              label="Placed to"
              value={params.to}
              min={params.from || undefined}
              onChange={(e) => updateUrl({ to: e.target.value, page: 1 })}
            />
          </div>
        </FilterField>
      </FilterBar>

      {list.isLoading ? (
        <SkeletonRows rows={8} cols={7} label="Loading orders…" />
      ) : list.isError ? (
        <ErrorState
          message={serverVerdict(list.error, 'Failed to load orders.')}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          icon={<Package size={20} />}
          title="No orders match"
          description="Try clearing the filters; new orders surface here as sellers submit."
        />
      ) : (
        <OoCard flush>
          <Table caption="Orders">
            <THead>
              <Tr>
                <Th>Order #</Th>
                <Th>Recipient</Th>
                <Th>Phone</Th>
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
                    <Link href={`/orders/${o.id}`} className="oc-order-link sk-ident">
                      {o.orderNumber}
                    </Link>
                    {o.sellerOrderRef && (
                      <span className="oo-sub">
                        ref: <span className="sk-ident">{o.sellerOrderRef}</span>
                      </span>
                    )}
                  </Td>
                  <Td>{o.recipientName}</Td>
                  <Td className="oo-muted oo-nowrap">
                    {/* Was City, blank on every order placed since the seller
                        form stopped asking (ORD-5: Delhivery resolves the
                        locality from the PIN) — so the column was a run of
                        dashes. The phone identifies the recipient and is
                        what the search box matches on. */}
                    <span className="sk-figure">{o.recipientPhoneE164 || '—'}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={orderStatusKind(o.status)}
                      label={statusLabel(o.status)}
                      size="sm"
                    />
                  </Td>
                  <Td>
                    <span className="oc-source">{chipWords(o.source.replace(/_/g, ' '))}</span>
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">{o.codAmountInr ?? '—'}</span>
                  </Td>
                  <Td className="oo-muted oo-nowrap">
                    <span className="sk-figure">
                      {new Date(o.placedAt).toISOString().slice(0, 16).replace('T', ' ')}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <div className="oo-card__foot">
            <Pagination
              page={params.page}
              pageSize={PAGE_SIZE}
              total={list.data.total}
              onPageChange={(next) => updateUrl({ page: next })}
              label="Orders pages"
            />
          </div>
        </OoCard>
      )}
    </div>
  );
}
