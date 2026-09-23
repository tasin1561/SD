'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactElement } from 'react';
import { Package, Search, Upload } from 'lucide-react';
import { OrderStatus } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { Tabs, type TabItem } from '@skydrop/ui/app/tabs';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { chipWords, StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { LabelIntoParcel } from '@skydrop/ui/app/label-into-parcel';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreOrders } from '@/lib/order-hooks';
import { LinkButton } from './_components/orders-parts';

const PAGE_SIZE = 20;
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
  return (
    <Suspense fallback={<SkeletonRows rows={6} cols={5} label="Loading orders" />}>
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
  const list = useStoreOrders({
    ...(status === '' ? {} : { status }),
    ...(search === '' ? {} : { search }),
    page,
    pageSize: PAGE_SIZE,
  });
  const mayPlace = can(me, 'orders.create');
  const filtered = status !== '' || search !== '';

  const tabs: TabItem[] = [
    { id: ALL_TAB, label: 'All' },
    ...[...TAB_STATUSES, ...(status !== '' && !TAB_STATUSES.includes(status) ? [status] : [])].map(
      (s): TabItem => ({ id: s, label: chipWords(statusLabel(s)) }),
    ),
  ];

  return (
    <div className="ro-page">
      <PageHeader
        title="Orders"
        subtitle="Everything your store has sold, and where each order has got to."
        action={
          mayPlace ? (
            <div className="ro-row">
              <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
                Upload a CSV
              </LinkButton>
              {/* The store's one primary call to action: the label drops
                  into the parcel on hover or focus. Feedback only — the
                  link navigates at once. */}
              <LabelIntoParcel>
                <LinkButton href="/orders/new" variant="primary">
                  New order
                </LinkButton>
              </LabelIntoParcel>
            </div>
          ) : undefined
        }
      />

      <section className="ro-section">
        <SectionHeading
          title="Your orders"
          note={
            list.data === undefined
              ? undefined
              : `${list.data.items.length} of ${list.data.total} shown`
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
                label="Search"
                aria-label="Search orders"
                placeholder="Order, reference, customer or waybill"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                trail={
                  <button
                    type="submit"
                    aria-label="Search"
                    title="Search"
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
              label="Status"
              aria-label="Filter by status"
              value={status}
              onChange={(e) => go({ status: statusParam(e.target.value), page: 1 })}
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

        <Tabs
          label="Filter by status"
          size="sm"
          items={tabs}
          value={status === '' ? ALL_TAB : status}
          onChange={(id) => go({ status: id === ALL_TAB ? '' : statusParam(id), page: 1 })}
        />

        {list.isPending ? (
          <SkeletonRows rows={6} cols={5} label="Loading orders" />
        ) : list.isError ? (
          <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={<Package size={20} />}
            title={!filtered ? 'No orders yet' : 'Nothing matches'}
            description={
              !filtered
                ? mayPlace
                  ? 'Place your first order from your catalogue, or upload a CSV of them.'
                  : 'Orders your store places will appear here.'
                : 'Try clearing the search or the status filter.'
            }
            action={
              !filtered && mayPlace ? (
                <LinkButton href="/orders/new" variant="primary">
                  New order
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <div className="ro-card" data-flush="1">
            <Table caption="Orders">
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th align="right">To collect</Th>
                  <Th>Placed</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((o) => (
                  <Tr key={o.id} onActivate={() => router.push(`/orders/${o.id}`)}>
                    <Td>
                      <Link href={`/orders/${o.id}`} className="ro-order-link sk-ident">
                        {o.orderNumber}
                      </Link>
                      {o.sellerOrderRef !== null && o.sellerOrderRef !== '' ? (
                        <span className="ro-sub">
                          ref <span className="sk-ident">{o.sellerOrderRef}</span>
                        </span>
                      ) : null}
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
                        label={statusLabel(o.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {o.codAmountInr === null ? (
                        <span className="ro-prepaid">Prepaid</span>
                      ) : (
                        <Money amount={o.codAmountInr} convert={false} />
                      )}
                    </Td>
                    <Td>
                      <span className="sk-figure ro-muted">
                        {new Date(o.placedAt).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="ro-table-foot">
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={list.data.total}
                onPageChange={(p) => go({ page: p })}
                label="Orders pages"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
