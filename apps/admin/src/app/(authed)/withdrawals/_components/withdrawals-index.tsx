'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import { Ident, Money } from '@skydrop/ui/components';
import { WithdrawalRequestStatus } from '@skydrop/db';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { Pagination } from '@skydrop/ui/app/pagination';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useApproveWithdrawal,
  useWithdrawalsList,
  type WithdrawalRequestView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { ResolveWithdrawalModal } from './resolve-withdrawal-modal';
import {
  MkCallout,
  MkCard,
  MkDl,
  WithdrawalChip,
} from '../../seller-wallets/_components/money-parts';

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
  // The row whose approval is being confirmed. Approving was one click
  // from the row; it is a money decision, so it now restates what it
  // approves before the SAME request goes.
  const [approving, setApproving] = useState<WithdrawalRequestView | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

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
  const toast = useToast();
  const approve = useApproveWithdrawal();
  const slaHours = list.data?.slaHours ?? 48;
  const breachedCount = list.data?.breachedCount ?? 0;
  const breachedInr = list.data?.breachedInr ?? '0.00';
  const oldestPendingHours = list.data?.oldestPendingHours ?? null;

  async function confirmApprove(): Promise<void> {
    if (approving === null) return;
    setApproveError(null);
    try {
      await approve.mutateAsync({ requestId: approving.id });
      toast.success('Approved — now pay and link it.');
    } catch (err) {
      // FE-2: the server owns the rules, including "the balance no
      // longer covers this". Shown verbatim inside the confirm.
      setApproveError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <div className="mk-page">
      <PageHeader
        title="Withdrawals"
        subtitle="Seller withdrawal requests, and the ones the auto-withdraw cycle raised. Nothing here moves money — pay the seller, record the remittance, then link it to close the request."
      />

      <div className="mk-kpis">
        <KpiCard
          label="Requested on this page"
          figure={<Money amount={pendingValue} decimals={false} />}
          tone={pendingValue > 0 ? 'pending' : 'neutral'}
          hint="Still pending a decision"
        />
        <KpiCard
          label="Matching this filter"
          figure={list.isLoading ? '—' : total}
          hint="Across all pages"
        />
        <KpiCard
          label="Auto-raised"
          figure={list.isLoading ? '—' : autoRaised}
          hint="Created by the auto-withdraw cycle, not by a seller"
        />
      </div>

      {/*
       * The promise, measured. `wallet.withdrawal_sla_hours` is what
       * the seller is told to expect, and until now nothing anywhere
       * checked whether we kept it — a request could sit past its own
       * SLA forever with no screen saying so.
       *
       * Shown only when something HAS breached: a permanent "0 late"
       * banner is the kind of thing people stop seeing, which is how
       * the one that matters gets missed.
       */}
      {breachedCount > 0 && (
        <MkCallout
          tone="critical"
          icon={<AlertTriangle size={16} />}
          title={`${breachedCount} past the ${slaHours}h we promised`}
        >
          <p>
            <Money amount={breachedInr} decimals={false} /> waiting
            {oldestPendingHours !== null && <> · longest {oldestPendingHours}h</>}
          </p>
        </MkCallout>
      )}

      <div className="mk-filters">
        <Select
          id="wd-status"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {Object.values(WithdrawalRequestStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </div>

      {list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load withdrawal requests.'}
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <SkeletonRows rows={5} cols={8} label="Loading withdrawal requests…" />
      ) : items.length === 0 ? (
        <EmptyState
          tone={status === WithdrawalRequestStatus.PENDING ? 'positive' : 'neutral'}
          title={
            status === WithdrawalRequestStatus.PENDING
              ? 'No pending requests'
              : 'No requests match this filter'
          }
          description={
            status === WithdrawalRequestStatus.PENDING
              ? 'Nothing is waiting on a withdrawal decision.'
              : 'Try widening the status filter.'
          }
        />
      ) : (
        <MkCard flush>
          <Table caption="Withdrawal requests">
            <THead>
              <Tr>
                <Th>Requested</Th>
                <Th>Seller</Th>
                <Th align="right">Amount</Th>
                <Th align="right">They receive</Th>
                <Th align="right">Wallet balance</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((w) => (
                <Tr key={w.id}>
                  <Td>
                    <div className="mk-cell">
                      <span className="mk-when sk-figure">
                        {new Date(w.createdAt).toLocaleDateString()}
                      </span>
                      {/* The wait, on the row that is waiting. A date alone
                          makes an operator do the arithmetic, and they only
                          do it for the rows they already suspect. */}
                      {w.waitingHours !== null && (
                        <span
                          className="mk-text mk-small sk-figure"
                          data-tone={w.slaBreached ? 'critical' : undefined}
                        >
                          waiting {w.waitingHours}h
                        </span>
                      )}
                    </div>
                  </Td>
                  {/* Deliberately NOT a clickable row. The link goes to the
                      SELLER, which is an attribute of this row rather than
                      its subject — the row is a withdrawal request. Sending the whole row
                      to the seller would take somebody somewhere they did
                      not ask to go, so the link stays a link. */}
                  <Td>
                    {/* The NAME. A truncated uuid identifies the row to
                        the database and to nobody deciding whether to
                        send money. */}
                    <Link href={`/sellers/${w.sellerId}`} className="mk-name">
                      {w.sellerName ?? <Ident value={`${w.sellerId.slice(0, 8)}…`} />}
                    </Link>
                  </Td>
                  <Td align="right">
                    <Money amount={w.amountRequested} currency={w.currency} />
                  </Td>
                  {/* At the rate frozen WHEN THEY ASKED, not today's —
                      the FX table is editable, so a request sitting in
                      this queue would otherwise read as a different
                      amount each morning with no record of which one
                      anybody saw. Blank where no rate was quoted. */}
                  <Td align="right">
                    {w.amountInHomeCurrency === null || w.homeCurrency === null ? (
                      <span className="mk-faint">—</span>
                    ) : (
                      <span
                        title={`At the rate when requested: 1 ${w.currency} = ${w.fxRateSnapshot ?? '?'} ${w.homeCurrency}`}
                      >
                        <Money
                          amount={w.amountInHomeCurrency}
                          currency={w.homeCurrency}
                          convert={false}
                        />
                      </span>
                    )}
                  </Td>
                  {/* The money it comes out of, beside the money asked
                      for. Approving is a judgement about whether the
                      wallet covers it, and sending somebody to another
                      page for that is how a request gets approved on a
                      balance nobody looked at. */}
                  <Td align="right">
                    {w.sellerBalanceInr === null ? (
                      <span className="mk-faint">—</span>
                    ) : (
                      <span
                        className="mk-text"
                        data-tone={
                          Number(w.sellerBalanceInr) < Number(w.amountRequested)
                            ? 'critical'
                            : undefined
                        }
                        title={
                          Number(w.sellerBalanceInr) < Number(w.amountRequested)
                            ? 'Less than the amount requested'
                            : undefined
                        }
                      >
                        <Money amount={w.sellerBalanceInr} currency="INR" />
                      </span>
                    )}
                  </Td>
                  <Td className="mk-small">
                    {w.requestedBy === 'SYSTEM' ? 'Auto-withdraw' : 'Seller'}
                  </Td>
                  <Td>
                    <div className="mk-cell">
                      <WithdrawalChip status={w.status} />
                      {w.rejectionReason !== null && (
                        <span className="mk-faint mk-clip" title={w.rejectionReason}>
                          {w.rejectionReason}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td align="right">
                    {w.status === WithdrawalRequestStatus.PENDING ||
                    w.status === WithdrawalRequestStatus.APPROVED ? (
                      <div className="mk-actions">
                        {/* Approve first, then pay. Resolve does not
                            appear on a pending row: paying straight from
                            PENDING skipped the one moment where the
                            balance is re-checked against what the seller
                            is about to be sent. */}
                        {w.status === WithdrawalRequestStatus.PENDING && (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<Check size={14} />}
                            disabled={approve.isPending}
                            onClick={() => {
                              setApproveError(null);
                              setApproving(w);
                            }}
                          >
                            Approve
                          </Button>
                        )}
                        {/* Reject stayed reachable only through Resolve,
                            and gating Resolve to APPROVED took it away
                            from the rows most likely to need it. Pending
                            gets its own button; approved keeps Resolve,
                            which offers pay or reject. */}
                        {w.status === WithdrawalRequestStatus.PENDING && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<X size={14} />}
                            onClick={() => setSelected(w)}
                          >
                            Reject
                          </Button>
                        )}
                        {/* An approved request can still be rejected —
                            the money has not moved, and a bounced
                            transfer is a real thing. */}
                        {w.status === WithdrawalRequestStatus.APPROVED && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<X size={14} />}
                              onClick={() => setSelected(w)}
                            >
                              Reject
                            </Button>
                            {/* Straight to where the payment happens.
                                "Resolve" used to open a form asking for a
                                remittance ID that does not exist yet —
                                you have to record the payment first, and
                                that is on Remittances, where this row is
                                already listed with a Pay button that
                                closes the request on success. */}
                            <Link
                              href="/remittances"
                              className={buttonClassName('secondary', 'sm')}
                            >
                              <span className="sk-btn__label">Pay on Remittances</span>
                              <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
                                <ArrowRight size={14} />
                              </span>
                            </Link>
                          </>
                        )}
                      </div>
                    ) : w.linkedRemittanceId !== null ? (
                      <span className="mk-faint">
                        Remittance <Ident value={w.linkedRemittanceId.slice(0, 8)} />
                      </span>
                    ) : (
                      <span className="mk-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={list.data?.page ?? page}
            pageSize={list.data?.pageSize ?? PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            label="Withdrawal pages"
          />
        </MkCard>
      )}

      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(next) => {
          if (!next) setApproving(null);
        }}
        title="Approve this withdrawal?"
        entity={
          approving === null
            ? ''
            : (approving.sellerName ?? `Seller ${approving.sellerId.slice(0, 8)}…`)
        }
        amount={
          approving === null ? undefined : (
            <Money amount={approving.amountRequested} currency={approving.currency} />
          )
        }
        consequence="Approving re-checks their wallet against this amount. Nothing is paid yet — pay the bank account on the seller's profile, record the remittance, and it closes this request."
        confirmLabel="Approve"
        onConfirm={confirmApprove}
        error={approveError}
      >
        {approving !== null && (
          <MkDl
            items={[
              {
                label: 'They receive',
                value:
                  approving.amountInHomeCurrency === null || approving.homeCurrency === null ? (
                    <span className="mk-faint">No rate quoted</span>
                  ) : (
                    <Money
                      amount={approving.amountInHomeCurrency}
                      currency={approving.homeCurrency}
                      convert={false}
                    />
                  ),
              },
              {
                label: 'Wallet balance now',
                value:
                  approving.sellerBalanceInr === null ? (
                    <span className="mk-faint">—</span>
                  ) : (
                    <Money amount={approving.sellerBalanceInr} currency="INR" />
                  ),
              },
              {
                label: 'Raised by',
                value: approving.requestedBy === 'SYSTEM' ? 'Auto-withdraw cycle' : 'The seller',
              },
            ]}
          />
        )}
      </ConfirmDialog>

      <ResolveWithdrawalModal request={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
