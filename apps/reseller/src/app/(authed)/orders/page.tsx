'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { OrderStatus } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Money,
  OrderStatusBadge,
  PageHeader,
  Section,
  Select,
  TBody,
  THead,
  Table,
  TablePaginator,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { statusLabel } from '@skydrop/ui/status';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreOrders } from '@/lib/order-hooks';

const PAGE_SIZE = 20;
const STATUSES = Object.values(OrderStatus);

/**
 * RS-5 — this store's orders. Placed here, by CSV or by the store's API
 * key, each goes to Skydrop's call centre to be confirmed with the
 * customer, then out of the seller's stock in our warehouse.
 */
export default function OrdersPage(): ReactElement {
  const me = useStoreIdentity();
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = useStoreOrders({
    ...(status === '' ? {} : { status }),
    ...(search === '' ? {} : { search }),
    page,
    pageSize: PAGE_SIZE,
  });
  const mayPlace = can(me, 'orders.create');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        subtitle="Everything your store has sold, and where each order has got to."
        action={
          mayPlace ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/orders/import">
                <Button variant="ghost" size="md">
                  Upload a CSV
                </Button>
              </Link>
              <Link href="/orders/new">
                <Button variant="primary" size="md">
                  New order
                </Button>
              </Link>
            </div>
          ) : undefined
        }
      />
      <Section
        title="Your orders"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput.trim());
                setPage(1);
              }}
            >
              <Input
                aria-label="Search orders"
                placeholder="Order, reference, customer or waybill"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-[260px]"
              />
            </form>
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus((e.target.value as OrderStatus | '') || '');
                setPage(1);
              }}
              className="w-[200px]"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {list.isPending ? (
          <LoadingState label="Loading orders" rows={6} />
        ) : list.isError ? (
          <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            title={status === '' && search === '' ? 'No orders yet' : 'Nothing matches'}
            description={
              status === '' && search === ''
                ? mayPlace
                  ? 'Place your first order from your catalogue, or upload a CSV of them.'
                  : 'Orders your store places will appear here.'
                : 'Try clearing the search or the status filter.'
            }
          />
        ) : (
          <>
            <Table>
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
                      <Link
                        href={`/orders/${o.id}`}
                        className="text-accent font-mono text-xs hover:underline"
                      >
                        {o.orderNumber}
                      </Link>
                      {o.sellerOrderRef !== null && o.sellerOrderRef !== '' ? (
                        <div className="text-text-faint mt-0.5 font-mono text-xs">
                          ref {o.sellerOrderRef}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <div className="text-text-body">{o.recipientName}</div>
                      <div className="text-text-faint mt-0.5 text-xs">
                        {[o.recipientPhoneE164, o.recipientCity, o.recipientPostalCode]
                          .filter((v) => v !== '')
                          .join(' · ')}
                      </div>
                    </Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td align="right">
                      {o.codAmountInr === null ? (
                        <span className="text-text-faint text-xs">Prepaid</span>
                      ) : (
                        <Money amount={o.codAmountInr} convert={false} />
                      )}
                    </Td>
                    <Td className="text-text-muted text-xs">
                      {new Date(o.placedAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="mt-2">
              <TablePaginator
                page={page}
                pageSize={PAGE_SIZE}
                total={list.data.total}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
