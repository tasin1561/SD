'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { ConsignmentRoute, ConsignmentStatus } from '@skydrop/db';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { consignmentStatusKind } from '@skydrop/ui/status';
import { useConsignmentsList, useSellersList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { Stack, Toolbar } from '../../../inventory/_components/stock-kit';
import { ROUTE_LABEL, STATUS_LABEL } from './labels';

const PAGE_SIZE = 20;

export function ConsignmentsIndex(): ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState<ConsignmentStatus | ''>('');
  const [route, setRoute] = useState<ConsignmentRoute | ''>('');
  const [sellerId, setSellerId] = useState('');
  const [page, setPage] = useState(1);

  // Same reasoning as the receive station: the seller list needs
  // `sellers.view`, this page needs `warehouse.view`, and a warehouse
  // account may hold one without the other. Hidden rather than shown
  // empty, which would read as "no sellers exist".
  const maySeeSellers = usePermission('sellers.view');
  const sellers = useSellersList({ page: 1, pageSize: 100 });

  const list = useConsignmentsList({
    ...(status === '' ? {} : { status: status as ConsignmentStatus }),
    ...(route === '' ? {} : { route: route as ConsignmentRoute }),
    ...(sellerId === '' ? {} : { sellerId }),
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <Stack>
      <Toolbar>
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ConsignmentStatus | '');
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as ConsignmentStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Route"
          value={route}
          onChange={(e) => {
            setRoute(e.target.value as ConsignmentRoute | '');
            setPage(1);
          }}
        >
          <option value="">Any route</option>
          {(Object.keys(ROUTE_LABEL) as ConsignmentRoute[]).map((r) => (
            <option key={r} value={r}>
              {ROUTE_LABEL[r]}
            </option>
          ))}
        </Select>
        {maySeeSellers && (
          <Select
            aria-label="Seller"
            value={sellerId}
            onChange={(e) => {
              setSellerId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All sellers</option>
            {(sellers.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>
        )}
      </Toolbar>

      {list.isLoading ? (
        <SkeletonRows rows={6} cols={6} />
      ) : list.isError ? (
        <ErrorState message="Could not load consignments." retry={() => void list.refetch()} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No consignments"
          description="Sellers announce these from their own dashboard before the stock travels."
        />
      ) : (
        <>
          <Table>
            <THead>
              <Tr>
                <Th>Consignment</Th>
                <Th>Seller</Th>
                <Th>Route</Th>
                <Th>Status</Th>
                <Th align="right">Legs</Th>
                <Th>Announced</Th>
              </Tr>
            </THead>
            <TBody>
              {(list.data?.items ?? []).map((c) => (
                <Tr
                  key={c.id}
                  onClick={() => router.push(`/warehouse/consignments/${c.id}`)}
                  interactive
                >
                  <Td className="sk-ident">{c.consignmentNumber}</Td>
                  <Td>{c.seller.companyName}</Td>
                  <Td>{ROUTE_LABEL[c.route]}</Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={consignmentStatusKind(c.status)}
                      label={STATUS_LABEL[c.status]}
                    />
                  </Td>
                  <Td align="right" className="sk-figure">
                    {c.receipts.length}
                  </Td>
                  <Td>{new Date(c.createdAt).toLocaleDateString('en-IN')}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={list.data?.page ?? 1}
            pageSize={list.data?.pageSize ?? PAGE_SIZE}
            total={list.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </Stack>
  );
}
