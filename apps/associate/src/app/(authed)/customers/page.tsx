'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Contact } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { seesOwnOnly } from '@/lib/orders-paused';
import { serverVerdict } from '@/lib/server-verdict';
import { useMyCustomers } from '@/lib/order-hooks';
import '../_components/as.css';

/**
 * ASSOC-1 — the people THIS person has sold to.
 *
 * "Theirs" is "somebody they have placed an order for": customer identity
 * is per OWNER (ORD-7), so two associates selling to the same number
 * share one customer row — the scope is over the ORDERS, not over the
 * identity, and it is applied in the server's WHERE clause.
 *
 * There is no customer DETAIL page here on purpose. What a sales person
 * actually wants from a name is "what have I sold them", and that is the
 * orders list filtered by their number — one screen instead of two, and
 * the row links straight to it.
 */
export default function CustomersPage(): ReactElement {
  const me = useStoreIdentity();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = useMyCustomers({ ...(search === '' ? {} : { search }), page });

  return (
    <div className="as-page">
      <PageHeader
        title="My customers"
        subtitle={
          seesOwnOnly(me)
            ? 'Everyone you have sold to. You see the people you placed an order for — not the rest of the store’s.'
            : 'Everyone your store has sold to.'
        }
      />
      <section className="as-section">
        <SectionHeading
          title="Customers"
          note={list.data === undefined ? undefined : `${list.data.total} in all`}
        />
        {/* The search COMMITS on Enter: the box holds what is being
            typed, the list reads what was asked for. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(input.trim());
            setPage(1);
          }}
        >
          <TableToolbar
            search={{
              value: input,
              onChange: setInput,
              label: 'Search customers',
              placeholder: 'Name, phone or email',
            }}
          />
        </form>
        {list.isPending ? (
          <SkeletonRows rows={5} cols={5} label="Loading customers" />
        ) : list.isError ? (
          <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            icon={<Contact size={20} />}
            title={search === '' ? 'No customers yet' : 'Nobody matches'}
            description={
              search === ''
                ? 'Everyone you place an order for appears here.'
                : 'Try a different name, number or email.'
            }
          />
        ) : (
          <div className="as-card" data-flush="1">
            <Table caption="My customers">
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                  <Th align="right">Orders</Th>
                  <Th>Last order</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.items.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link
                        href={`/orders?search=${encodeURIComponent(c.phoneE164)}`}
                        className="as-link"
                      >
                        {c.name ?? 'No name given'}
                      </Link>
                      <span className="as-sub">See what they have bought</span>
                    </Td>
                    <Td>
                      <span className="sk-ident">{c.phoneE164}</span>
                    </Td>
                    <Td>
                      <span className="as-muted">{c.email ?? '—'}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{c.totalOrdersCount}</span>
                    </Td>
                    <Td>
                      <span className="as-muted sk-figure">
                        {c.lastOrderAt === null
                          ? '—'
                          : new Date(c.lastOrderAt).toLocaleDateString('en-IN', {
                              dateStyle: 'medium',
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
                pageSize={20}
                total={list.data.total}
                onPageChange={setPage}
                label="Customer pages"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
