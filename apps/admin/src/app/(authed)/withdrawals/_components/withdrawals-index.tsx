'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Ident,
  Money,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Toolbar,
  Tr,
  WithdrawalStatusBadge,
} from '@skydrop/ui/components';
import { WithdrawalRequestStatus } from '@skydrop/db';
import { useWithdrawalsList, type WithdrawalRequestView } from '@/lib/ops-hooks';
import { ResolveWithdrawalModal } from './resolve-withdrawal-modal';

const PAGE_SIZE = 25;

/**
 * Seller withdrawal requests (R2).
 *
 * A request never moves money by itself — admin remittance stays the
 * sole executor. "Mark paid" links an already-recorded remittance to
 * the request; it does not create one. That separation is the reason a
 * seller can never initiate a debit, and the copy on this screen says
 * so rather than leaving an operator to assume.
 */
export function WithdrawalsIndex(): ReactElement {
  const [status, setStatus] = useState<string>(WithdrawalRequestStatus.PENDING);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<WithdrawalRequestView | null>(null);

  const list = useWithdrawalsList({
    ...(status === '' ? {} : { status }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pendingValue = items
    .filter((w) => w.status === WithdrawalRequestStatus.PENDING)
    .reduce((sum, w) => sum + Number(w.amountRequested), 0);
  const autoRaised = items.filter((w) => w.requestedBy === 'SYSTEM').length;

  return (
    <div>
      <PageHeader
        title="Withdrawals"
        subtitle="Seller payout requests, and the ones the auto-withdraw cycle raised. Approving one does not move money — record the remittance, then link it here."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Requested on this page"
          value={<Money amount={pendingValue} decimals={false} />}
          tone={pendingValue > 0 ? 'warn' : 'neutral'}
          hint="Still pending a decision"
        />
        <Stat
          label="Matching this filter"
          value={list.isLoading ? '—' : total}
          hint="Across all pages"
        />
        <Stat
          label="Auto-raised"
          value={list.isLoading ? '—' : autoRaised}
          hint="Created by the auto-withdraw cycle, not by a seller"
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="wd-status">
          Status
        </label>
        <Select
          id="wd-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-56"
        >
          <option value="">All statuses</option>
          {Object.values(WithdrawalRequestStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </Toolbar>

      {list.isError ? (
        <Card className="rounded-t-none border-t-0 p-3">
          <ErrorNote
            message={list.error?.message ?? 'Failed to load withdrawal requests.'}
            retry={() => void list.refetch()}
          />
        </Card>
      ) : list.isLoading ? (
        <Card className="rounded-t-none border-t-0">
          <SkeletonRows rows={5} cols={6} />
        </Card>
      ) : items.length === 0 ? (
        <Card className="rounded-t-none border-t-0">
          <EmptyState
            bare
            title={
              status === WithdrawalRequestStatus.PENDING
                ? 'No pending requests'
                : 'No requests match this filter'
            }
            description={
              status === WithdrawalRequestStatus.PENDING
                ? 'Nothing is waiting on a payout decision.'
                : 'Try widening the status filter.'
            }
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
          <THead>
            <Tr>
              <Th>Requested</Th>
              <Th>Seller</Th>
              <Th align="right">Amount</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((w) => (
              <Tr key={w.id}>
                <Td className="text-text-muted whitespace-nowrap">
                  {new Date(w.createdAt).toLocaleDateString()}
                </Td>
                {/* Deliberately NOT a clickable row. The link goes to the
                    SELLER, which is an attribute of this row rather than
                    its subject — the row is a payout request. Sending the whole row
                    to the seller would take somebody somewhere they did
                    not ask to go, so the link stays a link. */}
                <Td>
                  <Link href={`/sellers/${w.sellerId}`} className="text-accent hover:underline">
                    <Ident value={`${w.sellerId.slice(0, 8)}…`} />
                  </Link>
                </Td>
                <Td align="right">
                  <Money amount={w.amountRequested} currency={w.currency} />
                </Td>
                <Td className="text-text-muted text-xs">
                  {w.requestedBy === 'SYSTEM' ? 'Auto-withdraw' : 'Seller'}
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <WithdrawalStatusBadge status={w.status} />
                    {w.rejectionReason !== null && (
                      <span
                        className="text-text-faint max-w-[14rem] truncate text-xs"
                        title={w.rejectionReason}
                      >
                        {w.rejectionReason}
                      </span>
                    )}
                  </div>
                </Td>
                <Td align="right">
                  {w.status === WithdrawalRequestStatus.PENDING ||
                  w.status === WithdrawalRequestStatus.APPROVED ? (
                    <Button variant="secondary" size="sm" onClick={() => setSelected(w)}>
                      Resolve
                    </Button>
                  ) : w.linkedRemittanceId !== null ? (
                    <span className="text-text-faint text-xs">
                      Remittance <Ident value={w.linkedRemittanceId.slice(0, 8)} />
                    </span>
                  ) : (
                    <span className="text-text-faint text-xs">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
          <tfoot>
            <tr>
              <td colSpan={6} className="p-0">
                <TablePaginator
                  page={list.data?.page ?? page}
                  pageSize={list.data?.pageSize ?? PAGE_SIZE}
                  total={total}
                  onPageChange={setPage}
                />
              </td>
            </tr>
          </tfoot>
        </Table>
      )}

      <ResolveWithdrawalModal request={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
