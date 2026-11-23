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
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { can } from '@/lib/page-access';
import { seesOwnOnly } from '@/lib/orders-paused';
import { verdict } from '@/i18n/verdict';
import { useMyOrders } from '@/lib/order-hooks';
import { LinkButton } from '../_components/parts';
import { cloneHref } from '@/lib/clone-order';
import '../_components/as.css';
import { AboutThis } from '@/components/easy/about';

const STATUSES = Object.values(OrderStatus);

/**
 * ASSOC-1 capability 3 — the orders THIS person placed.
 *
 * The narrowing is `store_roles.order_scope = OWN`, applied in the
 * server's WHERE clause; nothing here filters anything. The subtitle says
 * so ONCE, plainly, rather than on every row: somebody who can see only
 * their own rows and is not told reads the list as missing orders.
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

  // The search, status and page live in the URL, so a link from elsewhere
  // (a customer row) opens the list already filtered, and the back button
  // returns to the same view.
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
  const [pageSize, setPageSize] = useRowsPerPage(`associate-orders:${me?.id ?? 'anon'}`);
  const list = useMyOrders({ ...listFilter, page, pageSize });

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

  return (
    <div className="as-page">
      <PageHeader
        title={t('orders.title')}
        meta={
          list.data === undefined ? undefined : (
            <span className="sk-ph__count sk-figure">
              {t('orders.shown', { shown: list.data.items.length, total: list.data.total })}
            </span>
          )
        }
        subtitle={
          <AboutThis text={seesOwnOnly(me) ? t('orders.subtitle.own') : t('orders.subtitle.all')} />
        }
        action={
          mayPlace ? (
            <div className="as-row">
              <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
                {t('orders.uploadCsv')}
              </LinkButton>
              <LinkButton href="/orders/new" variant="primary">
                {t('orders.newOrder')}
              </LinkButton>
            </div>
          ) : undefined
        }
      />

      <section className="as-section">
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
                    /* `skydrop-hit` gives a hand-rolled icon button the same 44px
                       coarse-pointer tap area the Button primitive has: a ::after
                       box that changes the hit target and not the layout. Without
                       it this renders 16×32 — under the 30px floor the responsive
                       sweep enforces, on an app whose entire audience is a phone. */
                    className="as-link skydrop-hit"
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
            className={mayBulk ? 'as-card ez-cards ez-lead-2 sk-bulk-table' : 'as-card'}
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
                      <Link href={`/orders/${o.id}`} className="as-link sk-ident">
                        {o.orderNumber}
                      </Link>
                      {o.sellerOrderRef !== null && o.sellerOrderRef !== '' ? (
                        <span className="as-sub">
                          {richMessage(t('orders.ref'), {
                            ref: <span className="sk-ident">{o.sellerOrderRef}</span>,
                          })}
                        </span>
                      ) : null}
                      {o.awbNumber !== null && o.awbNumber !== '' && (
                        <span className="as-sub">
                          <AwbCopy awb={o.awbNumber} />
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div>{o.recipientName}</div>
                      <span className="as-sub">
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
                        <span className="as-sub">{t('orders.prepaid')}</span>
                      ) : (
                        <Money amount={o.codAmountInr} convert={false} />
                      )}
                    </Td>
                    <Td>
                      <span className="sk-figure as-muted">
                        {formatDateTime(o.placedAt, locale)}
                      </span>
                    </Td>
                    {mayPlace && (
                      <Td align="right">
                        {/* One quiet icon per row: the order form pre-filled from this order. */}
                        <Link
                          href={cloneHref(o.id)}
                          className="as-link"
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
            <div className="as-table-foot">
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
