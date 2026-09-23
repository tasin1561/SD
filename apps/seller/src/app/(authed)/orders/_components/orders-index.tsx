'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { OrderStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useOrderStatusSummary, usePendingRows, useOrdersList } from '@/lib/api-hooks';
import { can, canSeePath } from '@/lib/page-access';
import { useResellerStores } from '@/lib/reseller-store-hooks';
import {
  CheckCircle2,
  Hourglass,
  Package,
  PhoneCall,
  Plus,
  Search,
  ShoppingCart,
  Truck,
  Upload,
} from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { Tabs, type TabItem } from '@skydrop/ui/app/tabs';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { chipWords, StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { LinkButton, MetaFact } from './orders-parts';
import { useStores } from '@/lib/store-hooks';

/**
 * Seller order list — URL-driven filter state so a deep-linked filter
 * is shareable + browser back/forward navigates the same set. The
 * list itself is fetched via TanStack Query; the URL is canonical,
 * the query string is the fetch params.
 *
 * ── THE 2026-09-05 REDESIGN ──────────────────────────────────────────
 * Built from two reference comps, one light and one dark. What was
 * taken from them: a stat strip that answers "how is my day going"
 * before the table does, filter CHIPS carrying counts instead of a
 * dropdown that hides them, and rows that give the recipient two lines
 * so a name and a destination are not competing for one.
 *
 * What was deliberately NOT taken, because the comps are drawings and
 * a drawing can show a control with nothing behind it:
 *
 *   - A "Hub: Dhaka (DAC-01)" destination line. We do not have hubs on
 *     an order, and `recipientCity` is BLANK on every order placed
 *     since the form stopped asking (ORD-5). The PIN is the one part of
 *     a destination that is always there, so that is what rows show.
 *   - A date-range filter and a "More Filters (2)" button. The list
 *     endpoint takes status and search; a filter control that cannot
 *     filter is worse than an absent one.
 *   - A selection checkbox column. There is no bulk action for a
 *     seller to apply to a selection, so it would be a column of
 *     checkboxes that do nothing.
 *   - An "Export Manifest" action. A manifest is OUR record of what
 *     went on a van (CUR-4); it is not the seller's to export.
 *
 * Every colour comes from the shared tokens (FE-6), so both themes are
 * one implementation rather than two.
 *
 * ── THE 2026-09-19 PASS (PRECISION LOGISTICS) ────────────────────────
 * The structure above was already right; this is the skin and the
 * furniture. The tiles moved onto the SHARED `Stat` (which grew
 * `icon` / `unit` / `foot` for exactly this shape), the local `Chip`
 * became `FilterChip` in `@skydrop/ui/components`, and the four
 * separate cards — filters, chips, table, footer — became ONE banded
 * region under a `SectionBand`, because a filter and the rows it
 * governs sitting in two bordered boxes read as unrelated panels.
 *
 * The exclusions above still stand. Two more from the newer comps:
 * a "Gateway: 99.98% nominal" reading (no such metric exists) and a
 * "Corridor sync: 2s ago" line (nothing polls, so there is no sync to
 * report the age of).
 */

const STATUSES = Object.values(OrderStatus);
const PAGE_SIZES = [15, 20, 50, 100] as const;

/**
 * When it was placed, as presets rather than two date pickers.
 *
 * The question a seller actually has is "since when", and a pair of
 * pickers asks for two answers to get one. `days: null` is everything.
 */
const RANGES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly days: number | null;
}> = [
  { key: '', label: 'Any time', days: null },
  { key: '1', label: 'Today', days: 1 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  // `days: null` like "Any time", but the presence of `from`/`to` in
  // the URL is what makes it a filter. Kept last: it is the answer for
  // "that week in August", which is a rarer question than "recently".
  { key: 'custom', label: 'Custom range…', days: null },
];
const DEFAULT_PAGE_SIZE = 20;
/** The status tab that means "no status filter". Not an OrderStatus value. */
const ALL_TAB = 'all';

/**
 * The chips, in lifecycle order.
 *
 * Ordered by where an order IS rather than by how many are there:
 * a chip that moves position as counts change is a chip people stop
 * being able to find. Anything a seller has that is not on this list
 * still reaches them through the "All statuses" select below.
 */
const CHIP_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CONFIRMED,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACKED,
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.DELIVERED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.CANCELLED,
];

/** Statuses each tile counts. Named once, read by tile and by nobody else. */
const PROCESSING: readonly OrderStatus[] = [
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CALL_NO_RESPONSE,
  OrderStatus.CALL_RESCHEDULED,
  OrderStatus.AWAITING_SELLER_DECISION,
  OrderStatus.CONFIRMED,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACKED,
];
const MOVING: readonly OrderStatus[] = [
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
];
const RETURNING: readonly OrderStatus[] = [
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
];

interface QueryParams {
  readonly status: OrderStatus | '';
  readonly search: string;
  /** Which shopfront. Empty means all of them. */
  readonly storeId: string;
  readonly range: string;
  /** `YYYY-MM-DD`, both optional — one end alone is a valid range. */
  readonly from: string;
  readonly to: string;
  readonly page: number;
  readonly pageSize: number;
}

function parseParams(sp: URLSearchParams): QueryParams {
  const status = sp.get('status') as OrderStatus | null;
  const size = Number(sp.get('pageSize'));
  return {
    status: status && (STATUSES as string[]).includes(status) ? status : '',
    search: sp.get('search') ?? '',
    storeId: sp.get('storeId') ?? '',
    range: RANGES.some((r) => r.key === (sp.get('range') ?? '')) ? (sp.get('range') ?? '') : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') ?? '') ? (sp.get('from') ?? '') : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.get('to') ?? '') ? (sp.get('to') ?? '') : '',
    page: Math.max(1, Number(sp.get('page')) || 1),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

export function OrdersIndex(): ReactElement {
  const identity = useSellerIdentity();
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => parseParams(new URLSearchParams(sp.toString())), [sp]);

  const [searchInput, setSearchInput] = useState(params.search);
  // CLOSED stores are still listed: they hold past orders, and a filter
  // that could not reach them would make those orders unfindable.
  const channelStores = useStores().data ?? [];
  // RS-5: the seller's reseller stores join the filter — their orders are
  // the seller's too (the customer is masked). Read only with the
  // permission that endpoint needs, so a login without it sees its
  // channel stores and no refusal.
  const resellerStores =
    useResellerStores(identity !== null && can(identity, 'stores.manage')).data ?? [];
  const stores = [
    ...channelStores.map((s) => ({ id: s.id, name: s.name })),
    ...resellerStores.map((s) => ({
      id: s.id,
      name: `${s.displayName ?? s.name} (reseller store)`,
    })),
  ];
  const pendingCount = usePendingRows().data?.length ?? 0;
  const summary = useOrderStatusSummary();

  const counts = useMemo(() => {
    const m = new Map<string, { count: number; cod: number }>();
    for (const r of summary.data?.byStatus ?? []) {
      m.set(r.status, { count: r.count, cod: Number(r.codInr) });
    }
    return m;
  }, [summary.data]);

  const countOf = useCallback(
    (statuses: readonly OrderStatus[]): number =>
      statuses.reduce((t, s) => t + (counts.get(s)?.count ?? 0), 0),
    [counts],
  );
  const codOf = useCallback(
    (statuses: readonly OrderStatus[]): number =>
      statuses.reduce((t, s) => t + (counts.get(s)?.cod ?? 0), 0),
    [counts],
  );

  const updateUrl = useCallback(
    (next: Partial<QueryParams>) => {
      const merged: QueryParams = { ...params, ...next };
      const nextSp = new URLSearchParams();
      if (merged.status) nextSp.set('status', merged.status);
      if (merged.search) nextSp.set('search', merged.search);
      if (merged.storeId) nextSp.set('storeId', merged.storeId);
      if (merged.range) nextSp.set('range', merged.range);
      if (merged.range === 'custom' && merged.from) nextSp.set('from', merged.from);
      if (merged.range === 'custom' && merged.to) nextSp.set('to', merged.to);
      if (merged.page !== 1) nextSp.set('page', String(merged.page));
      if (merged.pageSize !== DEFAULT_PAGE_SIZE) nextSp.set('pageSize', String(merged.pageSize));
      const qs = nextSp.toString();
      router.replace(qs ? `/orders?${qs}` : '/orders');
    },
    [params, router],
  );

  // The range resolved to an instant at render time rather than stored
  // as one: a URL carrying "last 7 days" still means the last 7 days
  // tomorrow, where a stored timestamp would quietly mean last week.
  const days = RANGES.find((r) => r.key === params.range)?.days ?? null;
  const custom = params.range === 'custom';
  const placedFrom = custom
    ? params.from === ''
      ? undefined
      : new Date(`${params.from}T00:00:00`).toISOString()
    : days === null
      ? undefined
      : new Date(Date.now() - days * 86_400_000).toISOString();
  // The END DAY IS INCLUSIVE. A person picking "to: 31 August" means
  // the whole of the 31st; sending midnight would silently drop that
  // day's orders and look like data loss rather than an off-by-one.
  const placedTo =
    custom && params.to !== '' ? new Date(`${params.to}T23:59:59.999`).toISOString() : undefined;

  const list = useOrdersList({
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.storeId ? { storeId: params.storeId } : {}),
    ...(placedFrom === undefined ? {} : { placedFrom }),
    ...(placedTo === undefined ? {} : { placedTo }),
    page: params.page,
    pageSize: params.pageSize,
  });

  const filtered =
    params.status !== '' || params.search !== '' || params.range !== '' || params.storeId !== '';
  // How many filter controls are narrowing the list — what the filter
  // bar's count and its Reset read. The same four `filtered` is made of.
  const activeFilters = [
    params.status !== '',
    params.search !== '',
    params.range !== '',
    params.storeId !== '',
  ].filter(Boolean).length;

  // The status chips, as a liquid-bead tab row. Same rule as before: a
  // status this seller has never had is not offered, one they have had
  // stays even at zero, and the active one always stays.
  const statusTabs: TabItem[] = [
    { id: ALL_TAB, label: 'All', count: summary.data?.total },
    ...CHIP_STATUSES.flatMap((s): TabItem[] => {
      const n = counts.get(s)?.count ?? 0;
      if (n === 0 && params.status !== s) return [];
      return [{ id: s, label: chipWords(statusLabel(s)), count: n }];
    }),
  ];

  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Fulfilment' }, { label: 'Orders' }]}
        Link={Link}
        title="Orders"
        subtitle="Everything you have sent us, and where each one has got to."
        meta={
          summary.data === undefined ? undefined : (
            <span className="ord-meta">
              <MetaFact tone="accent">{summary.data.total} placed</MetaFact>
              {countOf(MOVING) > 0 && <MetaFact dot>{countOf(MOVING)} on the road</MetaFact>}
              {pendingCount > 0 && <MetaFact tone="warn">{pendingCount} pending</MetaFact>}
            </span>
          )
        }
        action={
          <div className="ord-row">
            {/* Only when there IS something waiting. A permanent nav
                item for an empty queue is noise; a queue nobody knows
                about is worse than both. */}
            {pendingCount > 0 && canSeePath(identity, '/orders/pending') && (
              <LinkButton href="/orders/pending" variant="ghost" icon={<Hourglass size={15} />}>
                {pendingCount} pending
              </LinkButton>
            )}
            {canSeePath(identity, '/orders/import') && (
              <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
                CSV import
              </LinkButton>
            )}
            {canSeePath(identity, '/orders/new') && (
              <LinkButton href="/orders/new" variant="primary" icon={<Plus size={15} />}>
                New order
              </LinkButton>
            )}
          </div>
        }
      />

      {/* ── How the day is going, before the table says anything ────
             A value is ABSENT rather than 0 while loading: a tile reading
             "0 delivered" that then becomes 8 has told you something false
             in between. The count-up runs once per load, never on a
             refetch. */}
      <div className="ord-kpis">
        <KpiCard
          label="Total orders"
          icon={<ShoppingCart size={14} />}
          tone="neutral"
          {...(summary.data === undefined
            ? { figure: <span className="ord-faint">—</span> }
            : { value: summary.data.total, unit: 'orders' })}
          {...(summary.data === undefined
            ? {}
            : {
                foot: [{ label: 'COD placed', value: <Money amount={summary.data.totalCodInr} /> }],
              })}
        />
        <KpiCard
          label="Being processed"
          icon={<PhoneCall size={14} />}
          tone={countOf(PROCESSING) > 0 ? 'pending' : 'neutral'}
          {...(summary.data === undefined
            ? { figure: <span className="ord-faint">—</span> }
            : { value: countOf(PROCESSING), unit: 'orders' })}
          {...(summary.data === undefined
            ? {}
            : {
                foot: [
                  {
                    label: 'Awaiting the call',
                    value: counts.get(OrderStatus.PENDING_CONFIRMATION)?.count ?? 0,
                  },
                ],
              })}
        />
        <KpiCard
          label="On the road"
          icon={<Truck size={14} />}
          tone="info"
          {...(summary.data === undefined
            ? { figure: <span className="ord-faint">—</span> }
            : { value: countOf(MOVING), unit: 'parcels' })}
          {...(summary.data === undefined
            ? {}
            : {
                foot: [
                  {
                    label: 'Still to collect',
                    value: <Money amount={String(codOf(MOVING))} />,
                  },
                ],
              })}
        />
        <KpiCard
          label="Delivered"
          icon={<CheckCircle2 size={14} />}
          tone="credit"
          {...(summary.data === undefined
            ? { figure: <span className="ord-faint">—</span> }
            : { value: counts.get(OrderStatus.DELIVERED)?.count ?? 0, unit: 'settled' })}
          {...(summary.data === undefined
            ? {}
            : {
                foot: [
                  {
                    label: 'Collected',
                    value: <Money amount={String(counts.get(OrderStatus.DELIVERED)?.cod ?? 0)} />,
                  },
                  { label: 'Coming back', value: countOf(RETURNING) },
                ],
              })}
        />
      </div>

      {/* ── ONE region: the heading names it, the filters narrow it, the
             status tabs say what is in it, and the table is it. ───── */}
      <section className="ord-section">
        <SectionHeading
          title="Consignment monitor"
          note={
            list.data === undefined
              ? undefined
              : `${list.data.items.length} of ${list.data.total} shown`
          }
        />

        <FilterBar
          activeCount={activeFilters}
          onReset={() => {
            setSearchInput('');
            // `storeId` too. It counts towards `filtered`, so the
            // reset is offered because a store is selected — a Reset
            // that left it selected would not clear the thing that
            // summoned it.
            updateUrl({
              status: '',
              search: '',
              range: '',
              from: '',
              to: '',
              storeId: '',
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
              {/*
                ONE magnifier, and it is the button: a real
                <button type="submit"> with an aria-label, so Enter still
                submits, it is reachable by keyboard, and a screen reader
                hears "Search".
              */}
              <TextField
                label="Search"
                aria-label="Search orders"
                placeholder="Order number, ref, AWB, recipient name or phone…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                trail={
                  <button
                    type="submit"
                    aria-label="Search"
                    title="Search"
                    className="ord-search-btn"
                  >
                    <Search size={16} aria-hidden />
                  </button>
                }
              />
            </form>
          </FilterField>

          <FilterField>
            <Select
              label="Placed when"
              aria-label="Placed when"
              value={params.range}
              onChange={(e) => updateUrl({ range: e.target.value, from: '', to: '', page: 1 })}
            >
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </FilterField>

          {custom && (
            <FilterField wide>
              <div className="ord-dates">
                <DateField
                  label="From"
                  aria-label="Placed from"
                  value={params.from}
                  max={params.to === '' ? undefined : params.to}
                  onChange={(e) => updateUrl({ from: e.target.value, page: 1 })}
                />
                <DateField
                  label="To"
                  aria-label="Placed to"
                  value={params.to}
                  min={params.from === '' ? undefined : params.from}
                  onChange={(e) => updateUrl({ to: e.target.value, page: 1 })}
                />
              </div>
            </FilterField>
          )}

          {/* Only when there is a choice to make. One shopfront is the
              ordinary case, and a filter with a single option is a
              control that can only ever narrow to everything. */}
          {stores.length > 1 && (
            <FilterField>
              <Select
                label="Store"
                aria-label="Filter by store"
                value={params.storeId}
                onChange={(e) => updateUrl({ storeId: e.target.value, page: 1 })}
              >
                <option value="">All stores</option>
                {stores.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </Select>
            </FilterField>
          )}

          <FilterField>
            <Select
              label="Status"
              aria-label="Filter by status"
              value={params.status}
              onChange={(e) =>
                updateUrl({ status: (e.target.value as OrderStatus | '') || '', page: 1 })
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
        </FilterBar>

        {/* ── The counts live HERE rather than only in a dropdown,
               because "how many are stuck at the call" is the question
               this page is opened to answer. ───────────────────────── */}
        <Tabs
          label="Filter by status"
          size="sm"
          items={statusTabs}
          value={params.status === '' ? ALL_TAB : params.status}
          onChange={(id) =>
            updateUrl({ status: id === ALL_TAB ? '' : (id as OrderStatus), page: 1 })
          }
        />

        {list.isLoading ? (
          <SkeletonRows rows={6} cols={6} label="Loading orders…" />
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message ?? 'Failed to load orders.'}
            retry={() => void list.refetch()}
          />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            icon={<Package size={20} />}
            title={filtered ? 'No orders match that' : 'No orders yet'}
            description={
              filtered
                ? 'Try clearing the filters — the counts on the tabs above show what you do have.'
                : 'Orders appear here as you create them or your CSVs import.'
            }
            action={
              !filtered && canSeePath(identity, '/orders/new') ? (
                <LinkButton href="/orders/new" variant="primary" icon={<Plus size={15} />}>
                  New order
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <div className="ord-card" data-flush="1">
            <Table caption="Orders">
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Recipient</Th>
                  <Th>Phone</Th>
                  <Th>Status</Th>
                  <Th align="right">COD</Th>
                  <Th>Placed</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((o) => (
                  <Tr key={o.id} onActivate={() => router.push(`/orders/${o.id}`)}>
                    <Td>
                      <Link href={`/orders/${o.id}`} className="ord-order-link sk-ident">
                        {o.orderNumber}
                      </Link>
                      {o.sellerOrderRef !== null && o.sellerOrderRef !== '' && (
                        <span className="ord-sub">
                          ref <span className="sk-ident">{o.sellerOrderRef}</span>
                        </span>
                      )}
                      {/* RS-5: which reseller store placed it. */}
                      {o.storeKind === 'RESELLER' && (
                        <span className="ord-sub">
                          via{' '}
                          {o.storeId !== undefined ? (
                            <Link href={`/reseller-stores/${o.storeId}`} className="ord-link">
                              {o.storeNameSnapshot ?? 'a reseller store'}
                            </Link>
                          ) : (
                            (o.storeNameSnapshot ?? 'a reseller store')
                          )}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div>{o.recipientName}</div>
                      {/* City is blank on everything placed since the form
                          stopped asking (ORD-5), so the PIN carries the
                          destination and the city joins it when present. */}
                      <span className="ord-sub">
                        {[o.recipientCity, o.recipientPostalCode]
                          .filter((v) => v !== '')
                          .join(' · ') || '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="sk-figure ord-nowrap">{o.recipientPhoneE164 || '—'}</span>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={orderStatusKind(o.status)}
                        label={statusLabel(o.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {o.codAmountInr === null ? (
                        <span className="ord-prepaid">Prepaid</span>
                      ) : (
                        <Money amount={o.codAmountInr} />
                      )}
                    </Td>
                    <Td>
                      <span className="sk-figure ord-nowrap ord-muted">
                        {new Date(o.placedAt).toISOString().slice(0, 16).replace('T', ' ')}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="ord-table-foot">
              <Pagination
                page={params.page}
                pageSize={params.pageSize}
                total={list.data.total}
                pageSizes={PAGE_SIZES}
                onPageChange={(next) => updateUrl({ page: next })}
                onPageSizeChange={(n) => updateUrl({ pageSize: n, page: 1 })}
                label="Orders pages"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
