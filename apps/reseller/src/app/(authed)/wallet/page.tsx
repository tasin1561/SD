'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Select,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  WithdrawalStatusBadge,
  openExternalWhenReady,
  useToast,
} from '@skydrop/ui/components';
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
      <div className="space-y-6">
        <PageHeader title="Wallet" subtitle="Your store’s balance and every movement of it." />
        {summary.isPending ? (
          <LoadingState label="Loading the wallet" rows={4} />
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
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        subtitle={
          skydrop
            ? 'Skydrop manages this wallet: send money to our bank to top it up, and withdraw through us.'
            : `${s.sellerCompanyName} manages this wallet: they top it up for you and pay you directly.`
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Balance"
          value={<Money amount={s.balanceInr} size="lg" />}
          tone={Number(s.balanceInr) < 0 ? 'bad' : 'neutral'}
        />
        {s.withdrawableInr !== null ? (
          <Stat
            label="You can withdraw"
            value={<Money amount={s.withdrawableInr} size="lg" convert={false} />}
            hint="Your balance, less withdrawals already asked for."
          />
        ) : null}
        <Stat
          label="May go below zero by"
          value={<Money amount={s.negativeLimit.effectiveInr} size="lg" />}
          hint={`Set by ${s.sellerCompanyName}.`}
        />
        {skydrop ? (
          <Stat
            label="Waiting on Skydrop"
            value={`${s.pendingTopups.count + s.pendingWithdrawals.count}`}
            hint="Top-ups to be seen and withdrawals to be paid."
          />
        ) : null}
      </div>

      {mayTopUp ? <TopupCard /> : null}
      {mayWithdraw ? <WithdrawCard summary={s} /> : null}
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
  // IDEM-1: minted when the form opens, reused on a retry, new after a success.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const chosen = (accounts.data ?? []).find((a) => a.id === accountId) ?? null;

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
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
    }
  }

  return (
    <Card>
      <CardHeader
        title="Top up"
        subtitle="Send money to one of Skydrop’s accounts, then tell us here. Nothing is credited until we see it on our statement."
      />
      <CardBody>
        {accounts.isError ? (
          <ErrorState
            message={serverVerdict(accounts.error)}
            retry={() => void accounts.refetch()}
          />
        ) : (
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Paid into" htmlFor="tu-account" required>
              <Select
                id="tu-account"
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
            </FormField>
            <FormField label="Amount (₹)" htmlFor="tu-amount" required>
              <Input
                id="tu-amount"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
            {chosen !== null ? (
              <div className="text-text-muted text-sm md:col-span-2">
                {chosen.accountName} · {chosen.accountNumber}
                {chosen.branchCode !== null ? ` · IFSC ${chosen.branchCode}` : ''}
                {chosen.instructions !== null ? (
                  <div className="text-text-faint">{chosen.instructions}</div>
                ) : null}
              </div>
            ) : null}
            <FormField
              label="Bank reference / UTR"
              htmlFor="tu-ref"
              hint="This, or a receipt below — one of the two."
            >
              <Input id="tu-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
            <FormField label="Receipt (optional)" htmlFor="tu-proof" hint="JPEG, PNG, WEBP or PDF.">
              <Input
                id="tu-proof"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setProof(e.target.files?.[0] ?? null)}
              />
            </FormField>
            {error !== null ? (
              <p role="alert" className="text-critical text-sm md:col-span-2">
                {error}
              </p>
            ) : null}
            <div className="md:col-span-2">
              <Button type="submit" variant="primary" size="md" disabled={submit.isPending}>
                {submit.isPending ? 'Sending…' : 'Tell Skydrop'}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
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
    <div className="space-y-6">
      <Section title="Top-ups you told us about">
        {topups.isPending ? (
          <LoadingState label="Loading top-ups" rows={2} />
        ) : topups.isError ? (
          <ErrorState message={serverVerdict(topups.error)} retry={() => void topups.refetch()} />
        ) : topups.data.length === 0 ? (
          <EmptyState title="None yet" description="Use Top up above once you have sent money." />
        ) : (
          <Table>
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
                  <Td className="text-text-muted text-xs">{when(t.createdAt)}</Td>
                  <Td>
                    {t.bankLabel}
                    <div className="text-text-faint text-xs">{t.bankAccountNumber}</div>
                  </Td>
                  <Td align="right">
                    <Money amount={t.amountInr} />
                  </Td>
                  <Td className="text-xs">
                    {t.transactionRef ?? '—'}
                    {t.hasProof ? (
                      <div>
                        <button
                          type="button"
                          className="text-accent hover:underline"
                          onClick={() => void onProof(t.id)}
                        >
                          View receipt
                        </button>
                      </div>
                    ) : null}
                  </Td>
                  <Td className="text-xs">
                    {TOPUP_WORDS[t.status] ?? t.status}
                    {t.reviewNote !== null && t.reviewNote !== '' ? (
                      <div className="text-text-faint">{t.reviewNote}</div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      <Section title="Withdrawals you asked for">
        {withdrawals.isPending ? (
          <LoadingState label="Loading withdrawals" rows={2} />
        ) : withdrawals.isError ? (
          <ErrorState
            message={serverVerdict(withdrawals.error)}
            retry={() => void withdrawals.refetch()}
          />
        ) : withdrawals.data.length === 0 ? (
          <EmptyState title="None yet" />
        ) : (
          <Table>
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
                  <Td className="text-text-muted text-xs">{when(w.createdAt)}</Td>
                  <Td>
                    {w.payeeName}
                    <div className="text-text-faint text-xs">
                      {w.payeeBankName} · {w.payeeAccountNumber} · {w.payeeIfsc}
                    </div>
                  </Td>
                  <Td align="right">
                    <Money amount={w.amountInr} />
                  </Td>
                  <Td className="text-xs">
                    <WithdrawalStatusBadge status={w.status} audience="seller" />
                    {w.bankReference !== null ? (
                      <div className="text-text-faint">
                        {w.bankReference} · {when(w.paidAt)}
                      </div>
                    ) : null}
                    {w.rejectionReason !== null ? (
                      <div className="text-text-faint">{w.rejectionReason}</div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
