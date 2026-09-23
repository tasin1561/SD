'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreCustomers } from '@/lib/order-hooks';
import './_components/customers.css';

/**
 * RS-5 (ORD-7 generalised) — the people THIS store has sold to. They are
 * the store's customers: the seller whose stock you sell never sees their
 * names or numbers, and no other store does either.
 *
 * The search still COMMITS on Enter (the form's submit), exactly as it
 * did: the box holds what is being typed, the list reads what was asked.
 */
export default function CustomersPage(): ReactElement {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = useStoreCustomers({ ...(search === '' ? {} : { search }), page });

  return (
    <div className="rc-cst-page">
      <PageHeader
        title="Customers"
        subtitle="Everyone your store has sold to. They are your customers — the seller does not see them."
      />
      <section className="rc-cst-section">
        <SectionHeading title="Your customers" />
        <form
          className="rc-cst-search"
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
            title={search === '' ? 'No customers yet' : 'Nobody matches'}
            description={
              search === ''
                ? 'Everyone you place an order for appears here.'
                : 'Try a different name, number or email.'
            }
          />
        ) : (
          <>
            <Table caption="Your customers">
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
                  <Tr key={c.id} onActivate={() => router.push(`/customers/${c.id}`)}>
                    <Td>
                      <Link href={`/customers/${c.id}`} className="rc-cst-name">
                        {c.name ?? 'No name given'}
                      </Link>
                    </Td>
                    <Td>
                      <span className="rc-cst-phone sk-ident">{c.phoneE164}</span>
                    </Td>
                    <Td>
                      <span className="rc-cst-muted">{c.email ?? '—'}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{c.totalOrdersCount}</span>
                    </Td>
                    <Td>
                      <span className="rc-cst-muted sk-figure">
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
            <Pagination
              page={page}
              pageSize={20}
              total={list.data.total}
              onPageChange={setPage}
              label="Customer pages"
            />
          </>
        )}
      </section>
    </div>
  );
}
