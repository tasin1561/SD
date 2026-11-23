'use client';

import Link from 'next/link';
import { AwbCopy } from '@skydrop/ui/app/awb-copy';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState, type ReactElement } from 'react';
import { Copy, Package, Search, Upload } from 'lucide-react';
import { OrderStatus } from '@skydrop/db';
import { useApiClient, useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { Tabs, type TabItem } from '@skydrop/ui/app/tabs';
import {
  SelectAllTh,
  SelectTd,
  Table,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  useRowSelection,
} from '@skydrop/ui/app/data-table';
import {
  BulkActions,
  BulkSelectStrip,
  orderBulkActions,
  type BulkResponse,
  type BulkTransport,
} from '@skydrop/ui/app/bulk-actions';
import { useUiT } from '@skydrop/ui/app/i18n-client';
import { InfoButton } from '@/components/easy/info-button';
import { Pagination, ROWS_PER_PAGE, useRowsPerPage } from '@skydrop/ui/app/pagination';
import { chipWords, StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { LabelIntoParcel } from '@skydrop/ui/app/label-into-parcel';
import { can } from '@/lib/page-access';
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useStoreOrders } from '@/lib/order-hooks';
import { LinkButton } from './_components/orders-parts';
import { cloneHref } from '@/lib/clone-order';
import { AboutThis } from '@/components/easy/about';

const STATUSES = Object.values(OrderStatus);
/** The tab that means "no status filter". Not an OrderStatus value. */
const ALL_TAB = 'all';

/**
 * The statuses offered as tabs, in lifecycle order — the ones a store
 * looks for most. Every status is still reachable through the "All
 * statuses" select beside the search; a status the URL carries that is
 * not in this list joins the tabs so the active one is always visible.
 */
const TAB_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.AWAITING_SELLER_DECISION,
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

/**
 * RS-5 — this store's orders. Placed here, by CSV or by the store's API
 * key, each goes to Skydrop's call centre to be confirmed with the
 * customer, then out of the seller's stock in our warehouse.
 */
export default function OrdersPage(): ReactElement {
  const t = useT();
  return (
    <Suspense fallback={<SkeletonRows rows={6} cols={5} label={t('orders.loading')} />}>
      <OrdersList />
    </Suspense>
  );
}

/** Read a status from the URL, ignoring anything that is not one. */
function statusParam(v: string | null): OrderStatus | '' {
  return v !== null && (STATUSES as readonly string[]).includes(v) ? (v as OrderStatus) : '';
}

/**
 * The search, status and page live in the URL, so a link from elsewhere
 * (a customer, a P&L row) opens the list already filtered, and the back
 * button returns to the same view.
 */
function OrdersList(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const me = useStoreIdentity();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = statusParam(params.get('status'));
  const search = params.get('search')?.trim() ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [searchInput, setSearchInput] = useState(search);

  function go(next: { status?: OrderStatus | ''; search?: string; page?: number }): void {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    const q = next.search ?? search;
    const p = next.page ?? page;
    if (s !== '') sp.set('status', s);
    if (q !== '') sp.set('search', q);
    if (p > 1) sp.set('page', String(p));
    const qs = sp.toString();
    const base = pathname ?? '/orders';
    router.replace(qs === '' ? base : `${base}?${qs}`);
  }
  // The list's own filter, WITHOUT the page: "all N matching" exports send
  // exactly this, so the file holds what the list is showing.
  const listFilter = {
    ...(status === '' ? {} : { status }),
    ...(search === '' ? {} : { search }),
  };
  // Rows per page: this person's own choice for this list, kept on the device.
  const [pageSize, setPageSize] = useRowsPerPage(`store-orders:${me?.id ?? 'anon'}`);
  const list = useStoreOrders({ ...listFilter, page, pageSize });

  // ── Bulk actions: tick rows on this page, then act on them ──────────
  const uiT = useUiT();
  const client = useApiClient();
  const pageIds = useMemo(() => (list.data?.items ?? []).map((o) => o.id), [list.data]);
  const selection = useRowSelection(pageIds);
  const bulkActions = useMemo(
    () => orderBulkActions({ console: 'store', t: uiT, may: (p) => can(me, p) }),
    [uiT, me],
  );
  const bulkTransport = useMemo<BulkTransport>(
    () => ({
      post: (path, body) => client.request<BulkResponse>(path, { method: 'POST', body }),
      download: (path, body) => client.requestStream(path, { method: 'POST', body }),
    }),
    [client],
  );
  const mayBulk = bulkActions.length > 0;
  const mayPlace = can(me, 'orders.create');
  const filtered = status !== '' || search !== '';

  const tabs: TabItem[] = [
    { id: ALL_TAB, label: t('orders.tabAll') },
    ...[...TAB_STATUSES, ...(status !== '' && !TAB_STATUSES.includes(status) ? [status] : [])].map(
      (s): TabItem => ({ id: s, label: chipWords(statusLabel(s, locale)) }),
    ),
  ];

  return (
    <div className="ro-page">
      <PageHeader
        title={t('orders.title')}
        meta={
          list.data === undefined ? undefined : (
            <span className="sk-ph__count sk-figure">
              {t('orders.shown', { shown: list.data.items.length, total: list.data.total })}
            </span>
          )
        }
        subtitle={<AboutThis text={t('orders.subtitle')} />}
        action={
          mayPlace ? (
            <div className="ro-row">
              <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
                {t('orders.uploadCsv')}
              </LinkButton>
              {/* The store's one primary call to action: the label drops
                  into the parcel on hover or focus. Feedback only — the
                  link navigates at once. */}
              <LabelIntoParcel>
                <LinkButton href="/orders/new" variant="primary">
                  {t('orders.newOrder')}
                </LinkButton>
              </LabelIntoParcel>
            </div>
          ) : undefined
        }
      />

      <section className="ro-section">
        {/* The count is in the title row; the heading stays for screen readers. */}
        <SectionHeading
          className="sk-sh--sr"
          title={t('orders.section')}
          note={
            list.data === undefined
              ? undefined
              : t('orders.shown', { shown: list.data.items.length, total: list.data.total })
          }
        />

        <FilterBar
          activeCount={[status !== '', search !== ''].filter(Boolean).length}
          onReset={() => {
            setSearchInput('');
            go({ status: '', search: '', page: 1 });
          }}
        >
          <FilterField wide>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                go({ search: searchInput.trim(), page: 1 });
              }}
            >
              <TextField
                label={t('orders.search')}
                aria-label={t('orders.searchAria')}
                placeholder={t('orders.searchPlaceholder')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                trail={
                  <button
                    type="submit"
                    aria-label={t('orders.search')}
                    title={t('orders.search')}
                    className="ro-search-btn"
                  >
                    <Search size={16} aria-hidden />
                  </button>
                }
              />
            </form>
          </FilterField>
          <FilterField>
            <Select
              label={t('orders.status')}
              aria-label={t('orders.filterByStatus')}
              value={status}
              onChange={(e) => go({ status: statusParam(e.target.value), page: 1 })}
            >
              <option value="">{t('orders.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {chipWords(statusLabel(s, locale))}
                </option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>

        <Tabs
          label={t('orders.filterByStatus')}
          size="sm"
          items={tabs}
          value={status === '' ? ALL_TAB : status}
          onChange={(id) => go({ status: id === ALL_TAB ? '' : statusParam(id), page: 1 })}
        />

        {list.isPending ? (
          <SkeletonRows rows={6} cols={5} label={t('orders.loading')} />
        ) : list.isError ? (
          <ErrorState message={verdict(list.error, t)} retry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={<Package size={20} />}
            title={!filtered ? t('orders.empty.none') : t('orders.empty.noMatch')}
            description={
              !filtered
                ? mayPlace
                  ? t('orders.empty.firstOrder')
                  : t('orders.empty.willAppear')
                : t('orders.empty.clear')
            }
            action={
              !filtered && mayPlace ? (
                <LinkButton href="/orders/new" variant="primary">
                  {t('orders.newOrder')}
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <div
            className={mayBulk ? 'ro-card ez-cards ez-lead-2 sk-bulk-table' : 'ro-card'}
            data-flush="1"
          >
            {mayBulk && <BulkSelectStrip selection={selection} />}
            <Table caption={t('orders.table.caption')}>
              <THead>
                <Tr>
                  {mayBulk && (
                    <SelectAllTh selection={selection} label={uiT('ui.bulk.selectPage')} />
                  )}
                  <Th>{t('orders.col.order')}</Th>
                  <Th>{t('orders.col.customer')}</Th>
                  <Th>{t('orders.col.status')}</Th>
                  <Th align="right">{t('orders.col.collect')}</Th>
                  <Th>{t('orders.col.placed')}</Th>
                  {mayPlace && (
                    <Th align="right">
                      <span
                        style={{
                          position: 'absolute',
                          width: 1,
                          height: 1,
                          overflow: 'hidden',
                          clip: 'rect(0 0 0 0)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('cloneOrder.button')}
                      </span>
                    </Th>
                  )}
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((o) => (
                  <Tr
                    key={o.id}
                    selected={mayBulk && selection.isSelected(o.id)}
                    onActivate={() => router.push(`/orders/${o.id}`)}
                  >
                    {mayBulk && (
                      <SelectTd
                        selection={selection}
                        id={o.id}
                        label={uiT('ui.bulk.selectRow', { name: o.orderNumber })}
                      />
                    )}
                    <Td>
                      <Link href={`/orders/${o.id}`} className="ro-order-link sk-ident">
                        {o.orderNumber}
                      </Link>
                      {o.sellerOrderRef !== null && o.sellerOrderRef !== '' ? (
                        <span className="ro-sub">
                          {richMessage(t('orders.ref'), {
                            ref: <span className="sk-ident">{o.sellerOrderRef}</span>,
                          })}
                        </span>
                      ) : null}
                      {o.awbNumber !== null && o.awbNumber !== '' && (
                        <span className="ro-sub">
                          <AwbCopy awb={o.awbNumber} />
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div>{o.recipientName}</div>
                      <span className="ro-sub">
                        {[o.recipientPhoneE164, o.recipientCity, o.recipientPostalCode]
                          .filter((v) => v !== '')
                          .join(' · ')}
                      </span>
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
                        <span className="ro-prepaid">{t('orders.prepaid')}</span>
                      ) : (
                        <Money amount={o.codAmountInr} convert={false} />
                      )}
                    </Td>
                    <Td>
                      <span className="sk-figure ro-muted">
                        {formatDateTime(o.placedAt, locale)}
                      </span>
                    </Td>
                    {mayPlace && (
                      <Td align="right">
                        {/* One quiet icon per row: the order form pre-filled from this order. */}
                        <Link
                          href={cloneHref(o.id)}
                          className="ro-link"
                          title={t('cloneOrder.button')}
                          aria-label={t('cloneOrder.rowLabel', { order: o.orderNumber })}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Copy size={14} aria-hidden />
                        </Link>
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
            {mayBulk && (
              <BulkActions
                selection={selection}
                actions={bulkActions}
                transport={bulkTransport}
                labelFor={(id) => list.data?.items.find((o) => o.id === id)?.orderNumber}
                explain={(e) => verdict(e, t)}
                onDone={() => void list.refetch()}
                matching={{ total: list.data.total, filter: listFilter }}
                info={<InfoButton title={uiT('ui.bulk.region')} text={uiT('ui.bulk.info')} />}
              />
            )}
            <div className="ro-table-foot">
              <Pagination
                page={page}
                pageSize={pageSize}
                pageSizes={ROWS_PER_PAGE}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  go({ page: 1 });
                }}
                total={list.data.total}
                onPageChange={(p) => go({ page: p })}
                label={t('orders.pages')}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
