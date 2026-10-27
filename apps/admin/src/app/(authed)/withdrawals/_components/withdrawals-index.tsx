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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      toast.success(t('withdrawalsWithdrawalsIndex.approvedNowPayAndLink'));
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
        title={t('withdrawalsWithdrawalsIndex.withdrawals')}
        subtitle={t('withdrawalsWithdrawalsIndex.clientWithdrawalRequestsAndThe')}
      />

      <div className="mk-kpis">
        <KpiCard
          label={t('withdrawalsWithdrawalsIndex.requestedOnThisPage')}
          figure={<Money amount={pendingValue} decimals={false} />}
          tone={pendingValue > 0 ? 'pending' : 'neutral'}
          hint={t('withdrawalsWithdrawalsIndex.stillPendingADecision')}
        />
        <KpiCard
          label={t('withdrawalsWithdrawalsIndex.matchingThisFilter')}
          figure={list.isLoading ? '—' : total}
          hint={t('withdrawalsWithdrawalsIndex.acrossAllPages')}
        />
        <KpiCard
          label={t('withdrawalsWithdrawalsIndex.autoRaised')}
          figure={list.isLoading ? '—' : autoRaised}
          hint={t('withdrawalsWithdrawalsIndex.createdByTheAutoWithdraw')}
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
          title={t('withdrawalsWithdrawalsIndex.pastTheHWePromised', { breachedCount, slaHours })}
        >
          <p>
            <Money amount={breachedInr} decimals={false} /> waiting
            {oldestPendingHours !== null && (
              <> {t('withdrawalsWithdrawalsIndex.longestH', { oldestPendingHours })}</>
            )}
          </p>
        </MkCallout>
      )}

      <div className="mk-filters">
        <Select
          id="wd-status"
          label={t('withdrawalsWithdrawalsIndex.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('withdrawalsWithdrawalsIndex.allStatuses')}</option>
          {Object.values(WithdrawalRequestStatus).map((s) => (
            <option key={s} value={s}>
              {humanise(s)}
            </option>
          ))}
        </Select>
      </div>

      {list.isError ? (
        <ErrorState
          message={
            list.error?.message ?? t('withdrawalsWithdrawalsIndex.failedToLoadWithdrawalRequests')
          }
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <SkeletonRows
          rows={5}
          cols={8}
          label={t('withdrawalsWithdrawalsIndex.loadingWithdrawalRequests')}
        />
      ) : items.length === 0 ? (
        <EmptyState
          tone={status === WithdrawalRequestStatus.PENDING ? 'positive' : 'neutral'}
          title={
            status === WithdrawalRequestStatus.PENDING
              ? t('withdrawalsWithdrawalsIndex.noPendingRequests')
              : t('withdrawalsWithdrawalsIndex.noRequestsMatchThisFilter')
          }
          description={
            status === WithdrawalRequestStatus.PENDING
              ? t('withdrawalsWithdrawalsIndex.nothingIsWaitingOnA')
              : t('withdrawalsWithdrawalsIndex.tryWideningTheStatusFilter')
          }
        />
      ) : (
        <MkCard flush>
          <Table caption={t('withdrawalsWithdrawalsIndex.withdrawalRequests')}>
            <THead>
              <Tr>
                <Th>{t('withdrawalsWithdrawalsIndex.requested')}</Th>
                <Th>{t('withdrawalsWithdrawalsIndex.client')}</Th>
                <Th align="right">{t('withdrawalsWithdrawalsIndex.amount')}</Th>
                <Th align="right">{t('withdrawalsWithdrawalsIndex.theyReceive')}</Th>
                <Th align="right">{t('withdrawalsWithdrawalsIndex.walletBalance')}</Th>
                <Th>{t('withdrawalsWithdrawalsIndex.source')}</Th>
                <Th>{t('withdrawalsWithdrawalsIndex.status')}</Th>
                <Th align="right">{t('withdrawalsWithdrawalsIndex.actions')}</Th>
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
                          {t('withdrawalsWithdrawalsIndex.waitingH', {
                            waitingHours: w.waitingHours,
                          })}
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
                        title={t('withdrawalsWithdrawalsIndex.atTheRateWhenRequested', {
                          currency: w.currency,
                          value: w.fxRateSnapshot ?? '?',
                          homeCurrency: w.homeCurrency,
                        })}
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
                            ? t('withdrawalsWithdrawalsIndex.lessThanTheAmountRequested')
                            : undefined
                        }
                      >
                        <Money amount={w.sellerBalanceInr} currency="INR" />
                      </span>
                    )}
                  </Td>
                  <Td className="mk-small">
                    {w.requestedBy === 'SYSTEM'
                      ? t('withdrawalsWithdrawalsIndex.autoWithdraw')
                      : t('withdrawalsWithdrawalsIndex.client')}
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
                            {t('withdrawalsWithdrawalsIndex.approve')}
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
                            {t('withdrawalsWithdrawalsIndex.reject')}
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
                              {t('withdrawalsWithdrawalsIndex.reject')}
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
                              <span className="sk-btn__label">
                                {t('withdrawalsWithdrawalsIndex.payOnRemittances')}
                              </span>
                              <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
                                <ArrowRight size={14} />
                              </span>
                            </Link>
                          </>
                        )}
                      </div>
                    ) : w.linkedRemittanceId !== null ? (
                      <span className="mk-faint">
                        {t('withdrawalsWithdrawalsIndex.remittance')}{' '}
                        <Ident value={w.linkedRemittanceId.slice(0, 8)} />
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
            label={t('withdrawalsWithdrawalsIndex.withdrawalPages')}
          />
        </MkCard>
      )}

      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(next) => {
          if (!next) setApproving(null);
        }}
        title={t('withdrawalsWithdrawalsIndex.approveThisWithdrawal')}
        entity={
          approving === null
            ? ''
            : (approving.sellerName ??
              t('withdrawalsWithdrawalsIndex.client2', { value: approving.sellerId.slice(0, 8) }))
        }
        amount={
          approving === null ? undefined : (
            <Money amount={approving.amountRequested} currency={approving.currency} />
          )
        }
        consequence={t('withdrawalsWithdrawalsIndex.approvingReChecksTheirWallet')}
        confirmLabel={t('withdrawalsWithdrawalsIndex.approve')}
        onConfirm={confirmApprove}
        error={approveError}
      >
        {approving !== null && (
          <MkDl
            items={[
              {
                label: t('withdrawalsWithdrawalsIndex.theyReceive'),
                value:
                  approving.amountInHomeCurrency === null || approving.homeCurrency === null ? (
                    <span className="mk-faint">
                      {t('withdrawalsWithdrawalsIndex.noRateQuoted')}
                    </span>
                  ) : (
                    <Money
                      amount={approving.amountInHomeCurrency}
                      currency={approving.homeCurrency}
                      convert={false}
                    />
                  ),
              },
              {
                label: t('withdrawalsWithdrawalsIndex.walletBalanceNow'),
                value:
                  approving.sellerBalanceInr === null ? (
                    <span className="mk-faint">—</span>
                  ) : (
                    <Money amount={approving.sellerBalanceInr} currency="INR" />
                  ),
              },
              {
                label: t('withdrawalsWithdrawalsIndex.raisedBy'),
                value:
                  approving.requestedBy === 'SYSTEM'
                    ? t('withdrawalsWithdrawalsIndex.autoWithdrawCycle')
                    : t('withdrawalsWithdrawalsIndex.theClient'),
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
