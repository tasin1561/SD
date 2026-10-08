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
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { chipWords, StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { can } from '@/lib/page-access';
import { seesOwnOnly } from '@/lib/orders-paused';
import { serverVerdict } from '@/lib/server-verdict';
import { useMyOrders } from '@/lib/order-hooks';
import { LinkButton } from '../_components/parts';
import '../_components/as.css';

const PAGE_SIZE = 20;
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

function OrdersList(): ReactElement {
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

  const list = useMyOrders({
    ...(status === '' ? {} : { status }),
    ...(search === '' ? {} : { search }),
    page,
    pageSize: PAGE_SIZE,
  });
  const mayPlace = can(me, 'orders.create');
  const filtered = status !== '' || search !== '';

  return (
    <div className="as-page">
      <PageHeader
        title="My orders"
        subtitle={
          seesOwnOnly(me)
            ? 'The orders you placed, and where each one has got to. You see the orders you placed — not the rest of the store’s.'
            : 'Every order your store has placed, and where each one has got to.'
        }
        action={
          mayPlace ? (
            <div className="as-row">
              <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
                Upload a CSV
              </LinkButton>
              <LinkButton href="/orders/new" variant="primary">
                New order
              </LinkButton>
            </div>
          ) : undefined
        }
      />

      <section className="as-section">
        <SectionHeading
          title="Orders"
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
                  <button type="submit" aria-label="Search" title="Search" className="as-link">
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
                  ? 'Place your first order, or upload a CSV of them.'
                  : 'The orders you place will appear here.'
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
          <div className="as-card" data-flush="1">
            <Table caption="My orders">
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
                      <Link href={`/orders/${o.id}`} className="as-link sk-ident">
                        {o.orderNumber}
                      </Link>
                      {o.sellerOrderRef !== null && o.sellerOrderRef !== '' ? (
                        <span className="as-sub">
                          ref <span className="sk-ident">{o.sellerOrderRef}</span>
                        </span>
                      ) : null}
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
                        label={statusLabel(o.status)}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      {o.codAmountInr === null ? (
                        <span className="as-sub">Prepaid</span>
                      ) : (
                        <Money amount={o.codAmountInr} convert={false} />
                      )}
                    </Td>
                    <Td>
                      <span className="sk-figure as-muted">
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
            <div className="as-table-foot">
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={list.data.total}
                onPageChange={(p) => go({ page: p })}
                label="Order pages"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
