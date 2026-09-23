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
import { serverVerdict } from '@/lib/server-verdict';
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

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const TOPUP_WORDS: Record<string, string> = {
  PENDING: 'Waiting for Skydrop to see it',
  ACCEPTED: 'Credited',
  REJECTED: 'Not credited',
};

const HEADER_SUBTITLE = 'Your store’s balance and every movement of it.';

/**
 * The store's wallet (RS-6). Who manages it decides what this page offers:
 *   - SKYDROP: the store tops up by sending money to our bank (credited once
 *     a person sees it arrive) and withdraws through us;
 *   - the SELLER: read-only here — the seller tops it up from their own
 *     wallet and pays the store directly.
 */
export default function WalletPage(): ReactElement {
  const me = useStoreIdentity();
  const summary = useStoreWallet();

  if (summary.isPending || summary.isError) {
    return (
      <div className="rm-page">
        <PageHeader title="Wallet" subtitle={HEADER_SUBTITLE} />
        {summary.isPending ? (
          <>
            <div className="rm-kpis">
              <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
              <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
              <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
            </div>
            <SkeletonRows rows={4} cols={4} label="Loading the wallet" />
          </>
        ) : (
          <ErrorState message={serverVerdict(summary.error)} retry={() => void summary.refetch()} />
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
        title="Wallet"
        subtitle={
          skydrop
            ? 'Skydrop manages this wallet: send money to our bank to top it up, and withdraw through us.'
            : `${s.sellerCompanyName} manages this wallet: they top it up for you and pay you directly.`
        }
      />

      <div className="rm-kpis">
        <KpiCard
          label="Balance"
          icon={<Wallet size={14} />}
          figure={<Money amount={s.balanceInr} size="lg" />}
          tone={Number(s.balanceInr) < 0 ? 'debit' : 'neutral'}
        />
        {s.withdrawableInr !== null ? (
          <KpiCard
            label="You can withdraw"
            icon={<HandCoins size={14} />}
            figure={<Money amount={s.withdrawableInr} size="lg" convert={false} />}
            hint="Your balance, less withdrawals already asked for."
          />
        ) : null}
        <KpiCard
          label="May go below zero by"
          icon={<Gauge size={14} />}
          figure={<Money amount={s.negativeLimit.effectiveInr} size="lg" />}
          hint={`Set by ${s.sellerCompanyName}.`}
        />
        {skydrop ? (
          <KpiCard
            label="Waiting on Skydrop"
            icon={<Clock size={14} />}
            tone="pending"
            value={s.pendingTopups.count + s.pendingWithdrawals.count}
            format={(n) => `${n}`}
            hint="Top-ups to be seen and withdrawals to be paid."
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
          skydrop
            ? 'Top up the wallet to get started.'
            : `${s.sellerCompanyName} tops it up for you.`
        }
      />
    </div>
  );
}

function TopupCard(): ReactElement {
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
      toast.success('Sent to Skydrop. Your wallet is credited once they see the money arrive.');
      setAmount('');
      setReference('');
      setProof(null);
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      setError(serverVerdict(err));
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
            Top up
          </h2>
          <p className="rm-card__sub">
            Send money to one of Skydrop’s accounts, then tell us here. Nothing is credited until we
            see it on our statement.
          </p>
        </div>
      </div>
      {accounts.isError ? (
        <ErrorState message={serverVerdict(accounts.error)} retry={() => void accounts.refetch()} />
      ) : (
        <form onSubmit={onSubmit} className="rm-form">
          <Select
            id="tu-account"
            label="Paid into"
            required
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Choose the account you paid into</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.bankName}
              </option>
            ))}
          </Select>
          <TextField
            id="tu-amount"
            label="Amount (₹)"
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
                    {' · IFSC '}
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
            label="Bank reference / UTR"
            hint="This, or a receipt below — one of the two."
            inputClassName="sk-ident"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <DropZone
            key={idempotencyKey}
            id="tu-proof"
            label="Receipt (optional)"
            hint="JPEG, PNG, WEBP or PDF."
            buttonText="Choose a file"
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
              labels={{ idle: 'Tell Skydrop', busy: 'Sending…' }}
            />
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          <>
            Tell Skydrop you paid <Money amount={amountShown} convert={false} />?
          </>
        }
        entity={
          chosen === null
            ? 'The account you chose'
            : `${chosen.label} — ${chosen.bankName} · ${chosen.accountNumber}`
        }
        amount={<Money amount={amountShown} convert={false} />}
        consequence={
          reference.trim() === ''
            ? 'Nothing is credited until Skydrop sees the money on their statement.'
            : `Reference ${reference.trim()}. Nothing is credited until Skydrop sees the money on their statement.`
        }
        confirmLabel="Tell Skydrop"
        onConfirm={send}
      />
    </section>
  );
}

function RequestsSection(): ReactElement {
  const toast = useToast();
  const topups = useStoreTopups();
  const withdrawals = useStoreWithdrawals();
  const proof = useStoreTopupProof();

  async function onProof(topupId: string): Promise<void> {
    try {
      await openExternalWhenReady(async () => (await proof.mutateAsync({ topupId })).url);
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <>
      <RmSection>
        <SectionHeading title="Top-ups you told us about" />
        {topups.isPending ? (
          <SkeletonRows rows={2} cols={5} label="Loading top-ups" />
        ) : topups.isError ? (
          <ErrorState message={serverVerdict(topups.error)} retry={() => void topups.refetch()} />
        ) : topups.data.length === 0 ? (
          <EmptyState title="None yet" description="Use Top up above once you have sent money." />
        ) : (
          <Table caption="Top-ups you told us about">
            <THead>
              <Tr>
                <Th>Told us</Th>
                <Th>Paid into</Th>
                <Th align="right">Amount</Th>
                <Th>Reference</Th>
                <Th>State</Th>
              </Tr>
            </THead>
            <TBody>
              {topups.data.map((t) => (
                <Tr key={t.id}>
                  <Td className="rm-when sk-figure">{when(t.createdAt)}</Td>
                  <Td>
                    {t.bankLabel}
                    <div className="rm-faint sk-ident">{t.bankAccountNumber}</div>
                  </Td>
                  <Td align="right">
                    <Money amount={t.amountInr} />
                  </Td>
                  <Td>
                    <span className="sk-ident">{t.transactionRef ?? '—'}</span>
                    {t.hasProof ? (
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<FileText size={14} />}
                          onClick={() => void onProof(t.id)}
                        >
                          View receipt
                        </Button>
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <RmStateChip kind={topupStatusKind(t.status)}>
                      {TOPUP_WORDS[t.status] ?? t.status}
                    </RmStateChip>
                    {t.reviewNote !== null && t.reviewNote !== '' ? (
                      <div className="rm-faint">{t.reviewNote}</div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </RmSection>
      <RmSection>
        <SectionHeading title="Withdrawals you asked for" />
        {withdrawals.isPending ? (
          <SkeletonRows rows={2} cols={4} label="Loading withdrawals" />
        ) : withdrawals.isError ? (
          <ErrorState
            message={serverVerdict(withdrawals.error)}
            retry={() => void withdrawals.refetch()}
          />
        ) : withdrawals.data.length === 0 ? (
          <EmptyState title="None yet" />
        ) : (
          <Table caption="Withdrawals you asked for">
            <THead>
              <Tr>
                <Th>Asked</Th>
                <Th>To</Th>
                <Th align="right">Amount</Th>
                <Th>State</Th>
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
