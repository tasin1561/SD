'use client';

import { Fragment, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  Num,
  PageHeader,
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import { useCustomers } from '@/lib/account-hooks';
import { AddressHistory } from './address-history';
import { serverVerdict } from '@/lib/server-verdict';

const PAGE_SIZE = 25;

/**
 * Your customers.
 *
 * One row per phone number you have shipped to, with the counts that
 * actually matter in a COD market: how many orders they placed, how
 * many arrived, how many came back. RTO is the expensive one — a
 * customer who refuses parcels costs you the courier leg twice and
 * nobody is billed for it.
 *
 * The list is scoped to you by the server. A phone number that also
 * buys from another seller on Skydrop is a separate record with a
 * separate history; we do not merge them, deliberately.
 */
export function CustomersIndex(): ReactElement {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Expanded inline rather than in a modal: you are comparing this
  // customer's addresses against their totals in the row above.
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useCustomers({
    ...(search.trim() === '' ? {} : { search: search.trim() }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const rtoTotal = items.reduce((n, c) => n + c.rtoCount, 0);
  const orderTotal = items.reduce((n, c) => n + c.totalOrdersCount, 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Customers"
        subtitle="Everyone you have shipped to, and how those orders ended."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Customers shown" value={<Num value={items.length} />} />
        <Stat label="Orders between them" value={<Num value={orderTotal} />} />
        <Stat
          label="Returned to origin"
          hint="Across the customers on this page"
          value={<Num value={rtoTotal} />}
          tone={rtoTotal > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <Toolbar>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by phone or name"
          className="w-72"
          aria-label="Search customers"
        />
      </Toolbar>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={6} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={search === '' ? 'No customers yet' : 'Nobody matches that'}
            description={
              search === ''
                ? 'A customer record appears the first time you place an order for a phone number.'
                : 'Try the full phone number including the country code.'
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Phone</Th>
                  <Th>Name</Th>
                  <Th align="right">Orders</Th>
                  <Th align="right">Delivered</Th>
                  <Th align="right">RTO</Th>
                  <Th align="right">Refused</Th>
                  <Th>Risk</Th>
                  <Th>Last order</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((c) => (
                  <Fragment key={c.id}>
                    <Tr>
                      <Td>
                        <span className="font-mono text-xs">{c.phoneE164}</span>
                      </Td>
                      <Td>{c.name ?? '—'}</Td>
                      <Td align="right">
                        <Num value={c.totalOrdersCount} />
                      </Td>
                      <Td align="right">
                        <Num value={c.successfulOrdersCount} />
                      </Td>
                      <Td align="right">
                        {c.rtoCount === 0 ? (
                          <span className="text-text-faint">0</span>
                        ) : (
                          <span className="text-[var(--color-bad)]">{c.rtoCount}</span>
                        )}
                      </Td>
                      <Td align="right">
                        {c.refusedCount === 0 ? (
                          <span className="text-text-faint">0</span>
                        ) : (
                          <span className="text-[var(--color-bad)]">{c.refusedCount}</span>
                        )}
                      </Td>
                      <Td>
                        {c.riskLevel === null ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <StatusBadge
                            kind={riskKind(c.riskLevel)}
                            label={c.riskLevel.toLowerCase()}
                          />
                        )}
                      </Td>
                      <Td>
                        {c.lastOrderAt === null
                          ? '—'
                          : new Date(c.lastOrderAt).toLocaleDateString('en-IN')}
                      </Td>
                      <Td align="right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        >
                          {expanded === c.id ? 'Hide addresses' : 'Addresses'}
                        </Button>
                      </Td>
                    </Tr>
                    {expanded === c.id && (
                      <Tr>
                        <Td colSpan={9}>
                          <AddressHistory customerId={c.id} />
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function riskKind(level: string): 'delivered' | 'pending' | 'failed' {
  switch (level.toUpperCase()) {
    case 'LOW':
      return 'delivered';
    case 'MEDIUM':
      return 'pending';
    default:
      return 'failed';
  }
}
