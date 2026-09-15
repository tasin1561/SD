'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  DescriptionList,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  OrderStatusBadge,
  PageHeader,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreCustomer, useStoreOrders, type StoreCustomer } from '@/lib/order-hooks';

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * One of THIS store's customers (RS-5, ORD-7 per owner) and every order the
 * store has placed for them. Their orders are found by their phone number —
 * the one fact about a customer that never changes (ORD-7).
 */
export default function StoreCustomerPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const customer = useStoreCustomer(id);

  return (
    <div className="space-y-6">
      <Link
        href="/customers"
        className="text-text-muted hover:text-text-body inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={12} /> Customers
      </Link>
      {customer.isPending ? (
        <>
          <PageHeader title="Customer" />
          <LoadingState label="Loading the customer" rows={4} />
        </>
      ) : customer.isError ? (
        <>
          <PageHeader title="Customer" />
          <ErrorState
            message={serverVerdict(customer.error)}
            retry={() => void customer.refetch()}
          />
        </>
      ) : (
        <CustomerBody customer={customer.data} />
      )}
    </div>
  );
}

function CustomerBody({ customer: c }: { customer: StoreCustomer }): ReactElement {
  const router = useRouter();
  const orders = useStoreOrders({ search: c.phoneE164, pageSize: 50 });
  const allOrdersHref = `/orders?search=${encodeURIComponent(c.phoneE164)}`;

  return (
    <>
      <PageHeader
        title={c.name ?? 'No name given'}
        subtitle="Your customer — the seller does not see them."
      />
      <DescriptionList
        columns={2}
        items={[
          { label: 'Phone', value: <span className="font-mono text-xs">{c.phoneE164}</span> },
          {
            label: 'Other phone',
            value:
              c.altPhoneE164 === null ? (
                '—'
              ) : (
                <span className="font-mono text-xs">{c.altPhoneE164}</span>
              ),
          },
          { label: 'Email', value: c.email ?? '—' },
          { label: 'Orders', value: String(c.totalOrdersCount) },
          { label: 'Last order', value: when(c.lastOrderAt) },
          { label: 'First seen', value: when(c.createdAt) },
        ]}
      />
      <Section
        title="Their orders"
        subtitle="Newest first."
        action={
          <Link href={allOrdersHref} className="text-accent text-sm hover:underline">
            Open in orders →
          </Link>
        }
      >
        {orders.isPending ? (
          <LoadingState label="Loading their orders" rows={3} />
        ) : orders.isError ? (
          <ErrorState message={serverVerdict(orders.error)} retry={() => void orders.refetch()} />
        ) : orders.data.items.length === 0 ? (
          <EmptyState
            title="No orders found"
            description="Orders placed for this number appear here."
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Status</Th>
                  <Th align="right">To collect</Th>
                  <Th>Placed</Th>
                </Tr>
              </THead>
              <TBody>
                {orders.data.items.map((o) => (
                  <Tr key={o.id} onActivate={() => router.push(`/orders/${o.id}`)}>
                    <Td>
                      <Link
                        href={`/orders/${o.id}`}
                        className="text-accent font-mono text-xs hover:underline"
                      >
                        {o.orderNumber}
                      </Link>
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
                    <Td className="text-text-muted text-xs">{when(o.placedAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {orders.data.total > orders.data.items.length ? (
              <p className="text-text-muted mt-2 text-xs">
                Showing the latest {orders.data.items.length} of {orders.data.total}.{' '}
                <Link href={allOrdersHref} className="text-accent hover:underline">
                  See them all
                </Link>
              </p>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}
