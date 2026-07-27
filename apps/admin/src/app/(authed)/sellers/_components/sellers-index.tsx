'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { useSellersList } from '@/lib/api-hooks';
import type { SellerStatusValue } from '@skydrop/api-client';
import {
  Button,
  Input,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TableEmpty,
  TablePaginator,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SellerStatusBadge,
} from '@skydrop/ui/components';
import { InvitationsPanel } from './invitations-panel';
import { Plus } from 'lucide-react';
import { CreateInvitationDialog } from './create-invitation-dialog';

const PAGE_SIZE = 20;
const STATUSES: readonly SellerStatusValue[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

export function SellersIndex(): ReactElement {
  const [status, setStatus] = useState<SellerStatusValue | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);

  const list = useSellersList({
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Sellers"
        subtitle="Invitation lifecycle + seller status management."
        action={
          <Button variant="primary" size="md" onClick={() => setInviteOpen(true)}>
            <Plus size={14} /> Invite seller
          </Button>
        }
      />

      <InvitationsPanel />

      <div className="flex items-center gap-2 mb-3">
        <Input
          placeholder="Search by name, email, phone…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as SellerStatusValue | '');
            setPage(1);
          }}
          className="max-w-[180px]"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading sellers…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load sellers.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No sellers match these filters"
          description="Try clearing the filters or invite a new seller."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Company</Th>
              <Th>Contact</Th>
              <Th>Email</Th>
              <Th>Status</Th>
              <Th>Approved</Th>
              <Th>Created</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.items.map((s) => (
              <Tr key={s.id} interactive>
                <Td>
                  <Link
                    href={`/sellers/${s.id}`}
                    className="text-text-bright hover:underline"
                  >
                    {s.companyName}
                  </Link>
                </Td>
                <Td>{s.contactPersonName}</Td>
                <Td className="text-text-muted font-mono text-xs">{s.email}</Td>
                <Td>
                  <SellerStatusBadge status={s.status} />
                </Td>
                <Td className="text-text-muted text-xs font-mono">
                  {s.approvedAt
                    ? new Date(s.approvedAt).toISOString().slice(0, 10)
                    : '—'}
                </Td>
                <Td className="text-text-muted text-xs font-mono">
                  {new Date(s.createdAt).toISOString().slice(0, 10)}
                </Td>
              </Tr>
            ))}
          </TBody>
          {list.data.total === 0 && (
            <TableEmpty colSpan={6}>
              No sellers match this filter. Sellers appear here once they accept
              an invitation.
            </TableEmpty>
          )}
          <tfoot>
            <tr>
              <td colSpan={6} className="p-0">
                <TablePaginator
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={list.data.total}
                  onPageChange={setPage}
                />
              </td>
            </tr>
          </tfoot>
        </Table>
      )}

      <CreateInvitationDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
