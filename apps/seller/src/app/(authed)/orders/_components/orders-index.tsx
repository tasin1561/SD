'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { OrderStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useOrderStatusSummary, usePendingRows, useOrdersList } from '@/lib/api-hooks';
import { can, canSeePath } from '@/lib/page-access';
import { useResellerStores } from '@/lib/reseller-store-hooks';
import { Hourglass, Package, Plus, Search, Upload } from 'lucide-react';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { Select } from '@skydrop/ui/app/select';
import { Tabs, type TabItem } from '@skydrop/ui/app/tabs';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { chipWords, StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { LinkButton } from './orders-parts';
import {
  formatPlaced,
  KpiStrip,
  MoreFilters,
  OrdMoney,
  type KpiSegment,
} from './orders-list-parts';
import { useStores } from '@/lib/store-hooks';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { MessageKey } from '@/i18n/catalog';

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
  readonly labelKey: MessageKey;
  readonly days: number | null;
}> = [
  { key: '', labelKey: 'orderList.anyTime', days: null },
  { key: '1', labelKey: 'orderList.today', days: 1 },
  { key: '7', labelKey: 'orderList.last7Days', days: 7 },
  { key: '30', labelKey: 'orderList.last30Days', days: 30 },
  { key: '90', labelKey: 'orderList.last90Days', days: 90 },
  // `days: null` like "Any time", but the presence of `from`/`to` in
  // the URL is what makes it a filter. Kept last: it is the answer for
  // "that week in August", which is a rarer question than "recently".
  { key: 'custom', labelKey: 'orderList.customRange', days: null },
];
const DEFAULT_PAGE_SIZE = 50;
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
  const locale = useLocale();
  const t = useT();
  const identity = useSellerIdentity();
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => parseParams(new URLSearchParams(sp.toString())), [sp]);

  const [searchInput, setSearchInput] = useState(params.search);
  const [moreOpen, setMoreOpen] = useState(false);
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
      name: t('orderList.memberStoreName', { name: s.displayName ?? s.name }),
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
    { id: ALL_TAB, label: t('orderList.all'), count: summary.data?.total },
    ...CHIP_STATUSES.flatMap((s): TabItem[] => {
      const n = counts.get(s)?.count ?? 0;
      if (n === 0 && params.status !== s) return [];
      return [{ id: s, label: chipWords(statusLabel(s, locale)), count: n }];
    }),
  ];

  const rangeText =
    list.data === undefined || list.data.total === 0
      ? undefined
      : `${(params.page - 1) * params.pageSize + 1}–${Math.min(
          params.page * params.pageSize,
          list.data.total,
        )}`;

  /** A tile filters by ONE status (the list takes one): the first of its
      group that has orders, so the click lands on something non-empty. */
  const firstWith = (group: readonly OrderStatus[]): OrderStatus =>
    group.find((s) => (counts.get(s)?.count ?? 0) > 0) ?? (group[0] as OrderStatus);
  const loaded = summary.data !== undefined;
  const segments: KpiSegment[] = [
    {
      id: 'total',
      label: t('orderList.kpiTotal'),
      tint: 'neutral',
      value: summary.data?.total,
      active: params.status === '',
      onSelect: () => updateUrl({ status: '', page: 1 }),
      foot: loaded
        ? richMessage(t('orderList.kpiCodNote'), {
            amount: <OrdMoney amount={summary.data?.totalCodInr ?? 0} />,
          })
        : null,
    },
    {
      id: 'processing',
      label: t('orderList.kpiProcessing'),
      tint: 'warn',
      value: loaded ? countOf(PROCESSING) : undefined,
      active: params.status !== '' && PROCESSING.includes(params.status),
      onSelect: () => updateUrl({ status: firstWith(PROCESSING), page: 1 }),
      foot: loaded
        ? t('orderList.kpiAwaitingCall', {
            n: counts.get(OrderStatus.PENDING_CONFIRMATION)?.count ?? 0,
          })
        : null,
    },
    {
      id: 'moving',
      label: t('orderList.onTheRoad2'),
      tint: 'info',
      value: loaded ? countOf(MOVING) : undefined,
      active: params.status !== '' && MOVING.includes(params.status),
      onSelect: () => updateUrl({ status: firstWith(MOVING), page: 1 }),
      foot: loaded
        ? richMessage(t('orderList.kpiToCollect'), {
            amount: <OrdMoney amount={String(codOf(MOVING))} />,
          })
        : null,
    },
    {
      id: 'delivered',
      label: t('orderList.delivered'),
      tint: 'good',
      value: loaded ? (counts.get(OrderStatus.DELIVERED)?.count ?? 0) : undefined,
      active: params.status === OrderStatus.DELIVERED,
      onSelect: () => updateUrl({ status: OrderStatus.DELIVERED, page: 1 }),
      foot: loaded
        ? richMessage(t('orderList.kpiCollected'), {
            amount: <OrdMoney amount={String(counts.get(OrderStatus.DELIVERED)?.cod ?? 0)} />,
          })
        : null,
    },
    {
      id: 'returning',
      label: t('orderList.returning'),
      tint: 'bad',
      value: loaded ? countOf(RETURNING) : undefined,
      active: params.status !== '' && RETURNING.includes(params.status),
      onSelect: () => updateUrl({ status: firstWith(RETURNING), page: 1 }),
      foot: loaded ? t('orderList.kpiRtoNote') : null,
    },
  ];

  return (
    <div className="ord-page ord-page--list">
      {/* ── ONE row: where you are, how many, what you can do ──────── */}
      <header className="ord-head">
        <div className="ord-head__lead">
          <span className="ord-head__crumb">{t('orderList.fulfilment')} /</span>
          <h1 className="ord-head__title">{t('orderList.orders')}</h1>
          <span className="ord-head__pill sk-figure">{summary.data?.total ?? '—'}</span>
        </div>
        <div className="ord-head__actions">
          {/* Only when there IS something waiting. A permanent nav
              item for an empty queue is noise; a queue nobody knows
              about is worse than both. */}
          {pendingCount > 0 && canSeePath(identity, '/orders/pending') && (
            <LinkButton
              href="/orders/pending"
              variant="ghost"
              size="sm"
              icon={<Hourglass size={14} />}
            >
              {t('orderList.pendingN', { n: pendingCount })}
            </LinkButton>
          )}
          {canSeePath(identity, '/orders/import') && (
            <LinkButton href="/orders/import" variant="ghost" size="sm" icon={<Upload size={14} />}>
              {t('orderList.csvImport')}
            </LinkButton>
          )}
          {canSeePath(identity, '/orders/new') && (
            <LinkButton href="/orders/new" variant="primary" size="sm" icon={<Plus size={14} />}>
              {t('orderList.newOrder')}
            </LinkButton>
          )}
        </div>
      </header>

      {/* A value is ABSENT rather than 0 while loading: a tile reading
          "0 delivered" that then becomes 8 has told you something false
          in between. The count-up runs once per load, never on a refetch. */}
      <KpiStrip label={t('orderList.kpiStripLabel')} segments={segments} />

      <section className="ord-section ord-section--list">
        {/* ── Filters: one row, no card ─────────────────────────────── */}
        <div className="ord-filters">
          <form
            className="ord-filters__search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              updateUrl({ search: searchInput.trim(), page: 1 });
            }}
          >
            <Search size={14} aria-hidden className="ord-filters__icon" />
            <input
              type="search"
              className="ord-ctl ord-ctl--search"
              aria-label={t('orderList.searchOrders')}
              placeholder={t('orderList.orderNumberRefAwb')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {/* Enter submits; the button keeps it reachable by keyboard
                and by a screen reader ("Search"). */}
            <button type="submit" className="ord-sr" aria-label={t('orderList.search')}>
              {t('orderList.search')}
            </button>
          </form>

          <div className="ord-sel">
            <span className="ord-sel__k" aria-hidden>
              {t('orderList.placedWhen')}
            </span>
            <Select
              label={t('orderList.placedWhen')}
              aria-label={t('orderList.placedWhen')}
              value={params.range}
              onChange={(e) => {
                updateUrl({ range: e.target.value, from: '', to: '', page: 1 });
                if (e.target.value === 'custom') setMoreOpen(true);
              }}
            >
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {t(r.labelKey)}
                </option>
              ))}
            </Select>
          </div>

          {/* Only when there is a choice to make. One shopfront is the
              ordinary case, and a filter with a single option is a
              control that can only ever narrow to everything. */}
          {stores.length > 1 && (
            <div className="ord-sel">
              <span className="ord-sel__k" aria-hidden>
                {t('orderList.store')}
              </span>
              <Select
                label={t('orderList.store')}
                aria-label={t('orderList.filterByStore')}
                value={params.storeId}
                onChange={(e) => updateUrl({ storeId: e.target.value, page: 1 })}
              >
                <option value="">{t('orderList.allStores')}</option>
                {stores.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <MoreFilters
            open={moreOpen}
            setOpen={setMoreOpen}
            activeCount={(params.status !== '' ? 1 : 0) + (custom ? 1 : 0)}
            status={params.status}
            statuses={STATUSES.map((s) => ({
              value: s,
              label: chipWords(statusLabel(s, locale)),
            }))}
            onStatus={(v) => {
              updateUrl({ status: (v as OrderStatus | '') || '', page: 1 });
              setMoreOpen(false);
            }}
            from={params.from}
            to={params.to}
            onFrom={(v) => updateUrl({ range: 'custom', from: v, page: 1 })}
            onTo={(v) => updateUrl({ range: 'custom', to: v, page: 1 })}
            showDates
          />

          {activeFilters > 0 && (
            <button
              type="button"
              className="ord-filters__reset"
              onClick={() => {
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
              {t('orderList.reset')}
            </button>
          )}
        </div>

        {/* ── The counts live HERE rather than only in a dropdown,
               because "how many are stuck at the call" is the question
               this page is opened to answer. ───────────────────────── */}
        <div className="ord-tabsrow">
          <Tabs
            label={t('orderList.filterByStatus')}
            size="sm"
            className="ord-tabsrow__tabs"
            items={statusTabs}
            value={params.status === '' ? ALL_TAB : params.status}
            onChange={(id) =>
              updateUrl({ status: id === ALL_TAB ? '' : (id as OrderStatus), page: 1 })
            }
          />
          <span className="ord-tabsrow__count sk-figure" aria-live="polite">
            {rangeText !== undefined &&
              list.data !== undefined &&
              t('orderList.rangeOfTotal', { range: rangeText, total: list.data.total })}
          </span>
        </div>

        {list.isLoading ? (
          <SkeletonRows rows={8} cols={6} label={t('orderList.loadingOrders')} />
        ) : list.isError ? (
          <ErrorState
            message={list.error?.message ?? t('orderList.failedToLoadOrders')}
            retry={() => void list.refetch()}
          />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            icon={<Package size={20} />}
            title={filtered ? t('orderList.noOrdersMatchThat') : t('orderList.noOrdersYet')}
            description={
              filtered ? t('orderList.tryClearingTheFilters') : t('orderList.ordersAppearHereAs')
            }
            action={
              !filtered && canSeePath(identity, '/orders/new') ? (
                <LinkButton href="/orders/new" variant="primary" icon={<Plus size={15} />}>
                  {t('orderList.newOrder')}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <div className="ord-card ord-card--list" data-flush="1">
            <Table caption={t('orderList.orders')}>
              <THead>
                <Tr>
                  <Th>{t('orderList.order')}</Th>
                  <Th>{t('orderList.recipient')}</Th>
                  <Th className="ord-col-phone">{t('orderList.phone')}</Th>
                  <Th>{t('orderList.status')}</Th>
                  <Th align="right">{t('orderList.cod')}</Th>
                  <Th>{t('orderList.placed')}</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((o) => {
                  // City is blank on everything placed since the form
                  // stopped asking (ORD-5), so the PIN carries the
                  // destination and the city joins it when present.
                  const where = [o.recipientCity, o.recipientPostalCode]
                    .filter((v) => v !== '')
                    .join(' · ');
                  // Detail the dense row drops goes in the tooltip.
                  const tip = [o.recipientName, where, o.recipientPhoneE164]
                    .filter((v) => v !== '' && v !== null)
                    .join('\n');
                  return (
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
                                {o.storeNameSnapshot ?? t('orderList.aMemberStore')}
                              </Link>
                            ) : (
                              (o.storeNameSnapshot ?? t('orderList.aMemberStore'))
                            )}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="ord-recipient" title={tip}>
                          <span className="ord-recipient__name">{o.recipientName}</span>
                          <span className="ord-recipient__pin sk-figure">
                            {o.recipientPostalCode === '' ? '' : ` · ${o.recipientPostalCode}`}
                          </span>
                        </span>
                      </Td>
                      <Td className="ord-col-phone">
                        <span className="sk-figure ord-nowrap">{o.recipientPhoneE164 || '—'}</span>
                      </Td>
                      <Td>
                        <StatusChip
                          kind={orderStatusKind(o.status)}
                          label={statusLabel(o.status, locale)}
                          size="sm"
                        />
                      </Td>
                      <Td align="right">
                        {o.codAmountInr === null ? (
                          <span className="ord-prepaid">{t('orderList.prepaid')}</span>
                        ) : (
                          <OrdMoney amount={o.codAmountInr} />
                        )}
                      </Td>
                      <Td>
                        <span className="sk-figure ord-nowrap ord-muted">
                          {formatPlaced(o.placedAt, locale)}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
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
                label={t('orderList.ordersPages')}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
