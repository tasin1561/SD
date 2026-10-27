'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { Clock, FileText, Gauge, HandCoins, Landmark, Send, Wallet } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money, openExternalWhenReady } from '@skydrop/ui/components';
import { topupStatusKind, withdrawalStatusKind, withdrawalStatusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DropZone } from '@skydrop/ui/app/drop-zone';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import {
  useStoreBankAccounts,
  useStoreTopupProof,
  useStoreTopups,
  useStoreWallet,
  useStoreWithdrawals,
  useSubmitStoreTopup,
} from '@/lib/store-wallet-hooks';
import { LedgerSection } from './_components/ledger-section';
import { WithdrawCard } from './_components/withdraw-card';
import { RmAlert, RmSection, RmStateChip } from './_components/rm-parts';

const TOPUP_WORDS: Record<string, MessageKey> = {
  PENDING: 'wal.req.state.PENDING',
  ACCEPTED: 'wal.req.state.ACCEPTED',
  REJECTED: 'wal.req.state.REJECTED',
};

/**
 * The store's wallet (RS-6). Who manages it decides what this page offers:
 *   - SKYDROP: the store tops up by sending money to our bank (credited once
 *     a person sees it arrive) and withdraws through us;
 *   - the SELLER: read-only here — the seller tops it up from their own
 *     wallet and pays the store directly.
 */
export default function WalletPage(): ReactElement {
  const t = useT();
  const me = useStoreIdentity();
  const summary = useStoreWallet();

  if (summary.isPending || summary.isError) {
    return (
      <div className="rm-page">
        <PageHeader title={t('wal.title')} subtitle={t('wal.headerSubtitle')} />
        {summary.isPending ? (
          <>
            <div className="rm-kpis">
              <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
              <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
              <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
            </div>
            <SkeletonRows rows={4} cols={4} label={t('wal.loading')} />
          </>
        ) : (
          <ErrorState message={verdict(summary.error, t)} retry={() => void summary.refetch()} />
        )}
      </div>
    );
  }
  const s = summary.data;
  const skydrop = s.walletManagedBy === 'SKYDROP';
  const mayTopUp = skydrop && can(me, 'wallet.topups.manage');
  const mayWithdraw = skydrop && can(me, 'wallet.withdrawals.manage');

  return (
    <div className="rm-page">
      <PageHeader
        title={t('wal.title')}
        subtitle={
          skydrop
            ? t('wal.subtitle.skydrop')
            : t('wal.subtitle.seller', { seller: s.sellerCompanyName })
        }
      />

      <div className="rm-kpis">
        <KpiCard
          label={t('wal.kpi.balance')}
          icon={<Wallet size={14} />}
          figure={<Money amount={s.balanceInr} size="lg" />}
          tone={Number(s.balanceInr) < 0 ? 'debit' : 'neutral'}
        />
        {s.withdrawableInr !== null ? (
          <KpiCard
            label={t('wal.kpi.withdraw')}
            icon={<HandCoins size={14} />}
            figure={<Money amount={s.withdrawableInr} size="lg" convert={false} />}
            hint={t('wal.kpi.withdrawHint')}
          />
        ) : null}
        <KpiCard
          label={t('wal.kpi.negative')}
          icon={<Gauge size={14} />}
          figure={<Money amount={s.negativeLimit.effectiveInr} size="lg" />}
          hint={t('wal.kpi.negativeHint', { seller: s.sellerCompanyName })}
        />
        {skydrop ? (
          <KpiCard
            label={t('wal.kpi.waiting')}
            icon={<Clock size={14} />}
            tone="pending"
            value={s.pendingTopups.count + s.pendingWithdrawals.count}
            format={(n) => `${n}`}
            hint={t('wal.kpi.waitingHint')}
          />
        ) : null}
      </div>

      {mayTopUp || mayWithdraw ? (
        <div className="rm-pair">
          {mayTopUp ? <TopupCard /> : null}
          {mayWithdraw ? <WithdrawCard summary={s} /> : null}
        </div>
      ) : null}
      {skydrop ? <RequestsSection /> : null}

      <LedgerSection
        sellerCompanyName={s.sellerCompanyName}
        emptyDescription={
          skydrop ? t('wal.empty.skydrop') : t('wal.empty.seller', { seller: s.sellerCompanyName })
        }
      />
    </div>
  );
}

function TopupCard(): ReactElement {
  const t = useT();
  const toast = useToast();
  const accounts = useStoreBankAccounts();
  const submit = useSubmitStoreTopup();
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // IDEM-1: minted when the form opens, reused on a retry, new after a success.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const chosen = (accounts.data ?? []).find((a) => a.id === accountId) ?? null;

  // The form's own checks run first (the browser's `required`); the
  // confirmation then reads back where the money went and how much,
  // before the same request as always is sent.
  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setConfirming(true);
  }

  async function send(): Promise<void> {
    setError(null);
    try {
      await submit.mutateAsync({
        bankAccountId: accountId,
        amountInr: amount.trim(),
        transactionRef: reference.trim(),
        ...(proof === null ? {} : { proof }),
        idempotencyKey,
      });
      toast.success(t('wal.topup.toast'));
      setAmount('');
      setReference('');
      setProof(null);
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      setError(verdict(err, t));
    } finally {
      setConfirming(false);
    }
  }

  const amountShown = amount.trim() === '' ? '0' : amount.trim();

  return (
    <section className="rm-card" aria-labelledby="tu-title">
      <div className="rm-card__head">
        <span className="rm-card__chip" aria-hidden>
          <Landmark size={18} />
        </span>
        <div className="rm-card__titles">
          <h2 id="tu-title" className="rm-card__title">
            {t('wal.topup.title')}
          </h2>
          <p className="rm-card__sub">{t('wal.topup.sub')}</p>
        </div>
      </div>
      {accounts.isError ? (
        <ErrorState message={verdict(accounts.error, t)} retry={() => void accounts.refetch()} />
      ) : (
        <form onSubmit={onSubmit} className="rm-form">
          <Select
            id="tu-account"
            label={t('wal.topup.paidInto')}
            required
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">{t('wal.topup.chooseAccount')}</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.bankName}
              </option>
            ))}
          </Select>
          <TextField
            id="tu-amount"
            label={t('wal.topup.amount')}
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {chosen !== null ? (
            <div className="rm-bank rm-form__full">
              <div>
                {chosen.accountName} · <span className="sk-ident">{chosen.accountNumber}</span>
                {chosen.branchCode !== null ? (
                  <>
                    {t('wal.topup.ifsc')}
                    <span className="sk-ident">{chosen.branchCode}</span>
                  </>
                ) : (
                  ''
                )}
              </div>
              {chosen.instructions !== null ? (
                <div className="rm-faint">{chosen.instructions}</div>
              ) : null}
            </div>
          ) : null}
          <TextField
            id="tu-ref"
            label={t('wal.topup.ref')}
            hint={t('wal.topup.refHint')}
            inputClassName="sk-ident"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <DropZone
            key={idempotencyKey}
            id="tu-proof"
            label={t('wal.topup.receipt')}
            hint={t('wal.topup.receiptHint')}
            buttonText={t('wal.topup.chooseFile')}
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onFiles={(files) => setProof(files[0] ?? null)}
          />
          {error !== null ? <RmAlert>{error}</RmAlert> : null}
          <div className="rm-form__full rm-form__actions">
            <AsyncButton
              type="submit"
              variant="primary"
              size="md"
              icon={<Send size={15} />}
              state={submit.isPending ? 'busy' : 'idle'}
              labels={{ idle: t('wal.topup.tell'), busy: t('wal.topup.sending') }}
            />
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={richMessage(t('wal.topup.confirmTitle'), {
          amount: <Money amount={amountShown} convert={false} />,
        })}
        entity={
          chosen === null
            ? t('wal.topup.accountFallback')
            : `${chosen.label} — ${chosen.bankName} · ${chosen.accountNumber}`
        }
        amount={<Money amount={amountShown} convert={false} />}
        consequence={
          reference.trim() === ''
            ? t('wal.topup.consequence')
            : t('wal.topup.consequenceRef', { ref: reference.trim() })
        }
        confirmLabel={t('wal.topup.tell')}
        onConfirm={send}
      />
    </section>
  );
}

function RequestsSection(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string | null): string => (iso === null ? '—' : formatDateTime(iso, locale));
  const toast = useToast();
  const topups = useStoreTopups();
  const withdrawals = useStoreWithdrawals();
  const proof = useStoreTopupProof();

  async function onProof(topupId: string): Promise<void> {
    try {
      await openExternalWhenReady(async () => (await proof.mutateAsync({ topupId })).url);
    } catch (err) {
      toast.error(verdict(err, t));
    }
  }

  return (
    <>
      <RmSection>
        <SectionHeading title={t('wal.req.topups')} />
        {topups.isPending ? (
          <SkeletonRows rows={2} cols={5} label={t('wal.req.topupsLoading')} />
        ) : topups.isError ? (
          <ErrorState message={verdict(topups.error, t)} retry={() => void topups.refetch()} />
        ) : topups.data.length === 0 ? (
          <EmptyState title={t('wal.req.none')} description={t('wal.req.noneTopups')} />
        ) : (
          <Table caption={t('wal.req.topups')}>
            <THead>
              <Tr>
                <Th>{t('wal.req.col.told')}</Th>
                <Th>{t('wal.req.col.paidInto')}</Th>
                <Th align="right">{t('wal.req.col.amount')}</Th>
                <Th>{t('wal.req.col.reference')}</Th>
                <Th>{t('wal.req.col.state')}</Th>
              </Tr>
            </THead>
            <TBody>
              {topups.data.map((tu) => (
                <Tr key={tu.id}>
                  <Td className="rm-when sk-figure">{when(tu.createdAt)}</Td>
                  <Td>
                    {tu.bankLabel}
                    <div className="rm-faint sk-ident">{tu.bankAccountNumber}</div>
                  </Td>
                  <Td align="right">
                    <Money amount={tu.amountInr} />
                  </Td>
                  <Td>
                    <span className="sk-ident">{tu.transactionRef ?? '—'}</span>
                    {tu.hasProof ? (
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<FileText size={14} />}
                          onClick={() => void onProof(tu.id)}
                        >
                          {t('wal.req.viewReceipt')}
                        </Button>
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <RmStateChip kind={topupStatusKind(tu.status)}>
                      {TOPUP_WORDS[tu.status] === undefined
                        ? tu.status
                        : t(TOPUP_WORDS[tu.status] as MessageKey)}
                    </RmStateChip>
                    {tu.reviewNote !== null && tu.reviewNote !== '' ? (
                      <div className="rm-faint">{tu.reviewNote}</div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </RmSection>
      <RmSection>
        <SectionHeading title={t('wal.req.withdrawals')} />
        {withdrawals.isPending ? (
          <SkeletonRows rows={2} cols={4} label={t('wal.req.withdrawalsLoading')} />
        ) : withdrawals.isError ? (
          <ErrorState
            message={verdict(withdrawals.error, t)}
            retry={() => void withdrawals.refetch()}
          />
        ) : withdrawals.data.length === 0 ? (
          <EmptyState title={t('wal.req.none')} />
        ) : (
          <Table caption={t('wal.req.withdrawals')}>
            <THead>
              <Tr>
                <Th>{t('wal.req.wcol.asked')}</Th>
                <Th>{t('wal.req.wcol.to')}</Th>
                <Th align="right">{t('wal.req.col.amount')}</Th>
                <Th>{t('wal.req.col.state')}</Th>
              </Tr>
            </THead>
            <TBody>
              {withdrawals.data.map((w) => (
                <Tr key={w.id}>
                  <Td className="rm-when sk-figure">{when(w.createdAt)}</Td>
                  <Td>
                    {w.payeeName}
                    <div className="rm-faint">
                      {w.payeeBankName} · <span className="sk-ident">{w.payeeAccountNumber}</span> ·{' '}
                      <span className="sk-ident">{w.payeeIfsc}</span>
                    </div>
                  </Td>
                  <Td align="right">
                    <Money amount={w.amountInr} />
                  </Td>
                  <Td>
                    <StatusChip
                      kind={withdrawalStatusKind(w.status)}
                      label={withdrawalStatusLabel(w.status, 'seller')}
                      size="sm"
                    />
                    {w.bankReference !== null ? (
                      <div className="rm-faint">
                        <span className="sk-ident">{w.bankReference}</span> · {when(w.paidAt)}
                      </div>
                    ) : null}
                    {w.rejectionReason !== null ? (
                      <div className="rm-faint">{w.rejectionReason}</div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </RmSection>
    </>
  );
}
