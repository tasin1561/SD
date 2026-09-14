'use client';

import { useState, type ReactElement } from 'react';
import {
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Section,
  TBody,
  THead,
  Table,
  TablePaginator,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreCustomers } from '@/lib/order-hooks';

/**
 * RS-5 (ORD-7 generalised) — the people THIS store has sold to. They are
 * the store's customers: the seller whose stock you sell never sees their
 * names or numbers, and no other store does either.
 */
export default function CustomersPage(): ReactElement {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = useStoreCustomers({ ...(search === '' ? {} : { search }), page });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Everyone your store has sold to. They are your customers — the seller does not see them."
      />
      <Section
        title="Your customers"
        action={
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(input.trim());
              setPage(1);
            }}
          >
            <Input
              aria-label="Search customers"
              placeholder="Name, phone or email"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-[240px]"
            />
          </form>
        }
      >
        {list.isPending ? (
          <LoadingState label="Loading customers" rows={5} />
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
            <Table>
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
                    <Td>{c.name ?? '—'}</Td>
                    <Td className="font-mono text-xs">{c.phoneE164}</Td>
                    <Td className="text-xs">{c.email ?? '—'}</Td>
                    <Td align="right">{c.totalOrdersCount}</Td>
                    <Td className="text-text-muted text-xs">
                      {c.lastOrderAt === null
                        ? '—'
                        : new Date(c.lastOrderAt).toLocaleDateString('en-IN', {
                            dateStyle: 'medium',
                          })}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="mt-2">
              <TablePaginator
                page={page}
                pageSize={20}
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
