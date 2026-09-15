'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  Section,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { isStoreWalletCredit, storeWalletDirectionLabel } from '@skydrop/ui/status';
import { can } from '@/lib/page-access';
import type { ResellerStoreDetail } from '@/lib/reseller-store-hooks';
import {
  useRecordResellerStorePayout,
  useResellerStoreWallet,
  useResellerStoreWalletEntries,
  useSetResellerStoreNegativeLimit,
  useTopUpResellerStore,
} from '@/lib/reseller-store-wallet-hooks';
import { serverVerdict } from '@/lib/server-verdict';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * RS-6 — the store's wallet, as its seller sees it. A ledger between you
 * and the store (decision 7: the cash behind it is yours in our books).
 * For a store whose wallet you manage you top it up from your own wallet
 * and RECORD paying it — you pay it yourself, off-platform (decision 9).
 * You also decide how far below zero it may go: your risk, capped by
 * Skydrop. Everything here needs `stores.wallet`.
 */
export function StoreWalletSection({
  store,
}: {
  readonly store: ResellerStoreDetail;
}): ReactElement | null {
  const allowed = can(useSellerIdentity(), 'stores.wallet');
  const summary = useResellerStoreWallet(store.id, allowed);
  const entries = useResellerStoreWalletEntries(store.id, allowed);
  const [topUp, setTopUp] = useState(false);
  const [payout, setPayout] = useState(false);
  const ledger = entries.data?.pages.flatMap((p) => p.items) ?? [];
  // Read before the success branch narrows the union: inside it the type
  // says a next-page error cannot exist, so the check would be dead code.
  const olderFailed = entries.isFetchNextPageError ? entries.failureReason : null;

  if (!allowed) return null;
  const open = store.status === 'ACTIVE' || store.status === 'PAUSED';

  return (
    <Section
      title="The store’s wallet"
      subtitle={
        store.walletManagedBy === 'SELLER'
          ? 'You manage it: top it up from your own wallet, and record paying the store when you do.'
          : 'Skydrop manages it: the store tops up to Skydrop’s bank and withdraws through Skydrop.'
      }
      action={
        open && store.walletManagedBy === 'SELLER' ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="md" onClick={() => setTopUp(true)}>
              Top up
            </Button>
            <Button variant="secondary" size="md" onClick={() => setPayout(true)}>
              Record a payout
            </Button>
          </div>
        ) : undefined
      }
    >
      {summary.isPending ? (
        <LoadingState label="Loading the wallet" rows={2} />
      ) : summary.isError ? (
        <ErrorState message={serverVerdict(summary.error)} retry={() => void summary.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Balance"
              value={<Money amount={summary.data.balanceInr} size="lg" />}
              tone={Number(summary.data.balanceInr) < 0 ? 'bad' : 'neutral'}
              hint={
                Number(summary.data.balanceInr) < 0
                  ? 'Below zero: the store owes you this, and it comes off what you can withdraw.'
                  : undefined
              }
            />
            <Stat
              label="May go below zero by"
              value={<Money amount={summary.data.negativeLimit.effectiveInr} size="lg" />}
              hint={
                <>
                  Skydrop allows up to <Money amount={summary.data.negativeLimit.capInr} /> for your
                  account.
                </>
              }
            />
            <Stat
              label="Waiting on Skydrop"
              value={`${summary.data.pendingTopups.count + summary.data.pendingWithdrawals.count}`}
              hint="The store’s top-ups and withdrawals Skydrop has not settled yet."
            />
          </div>
          {open ? (
            <NegativeLimitForm
              storeId={store.id}
              current={summary.data.negativeLimit.ownInr}
              cap={summary.data.negativeLimit.capInr}
            />
          ) : null}
        </div>
      )}

      <div className="mt-4">
        {entries.isPending ? (
          <LoadingState label="Loading the ledger" rows={3} />
        ) : entries.isError ? (
          <ErrorState message={serverVerdict(entries.error)} retry={() => void entries.refetch()} />
        ) : ledger.length === 0 ? (
          <EmptyState
            title="Nothing has moved yet"
            description={
              store.walletManagedBy === 'SELLER' && open
                ? 'Top it up to give the store money to work with.'
                : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>When</Th>
                  <Th>What</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                </Tr>
              </THead>
              <TBody>
                {ledger.map((e) => (
                  <Tr key={e.id}>
                    <Td className="text-text-muted text-xs">{when(e.createdAt)}</Td>
                    <Td>
                      <div>{storeWalletDirectionLabel(e.direction, 'you')}</div>
                      {e.linkedOrderId !== null ? (
                        <Link
                          href={`/orders/${e.linkedOrderId}`}
                          className="text-accent text-xs hover:underline"
                        >
                          See the order
                        </Link>
                      ) : null}
                      {e.note !== null ? (
                        <div className="text-text-faint text-xs">{e.note}</div>
                      ) : null}
                    </Td>
                    <Td align="right">
                      <Money
                        amount={e.amountInr}
                        direction={isStoreWalletCredit(e.direction) ? 'credit' : 'debit'}
                      />
                    </Td>
                    <Td align="right">
                      <Money amount={e.runningBalanceAfterInr} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-text-muted text-xs">
                {entries.hasNextPage
                  ? `Showing the latest ${ledger.length} movements.`
                  : `Showing all ${ledger.length} movements.`}
              </p>
              {entries.hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={entries.isFetchingNextPage}
                  onClick={() => void entries.fetchNextPage()}
                >
                  {entries.isFetchingNextPage ? 'Loading…' : 'Show older'}
                </Button>
              ) : null}
            </div>
            {olderFailed !== null ? (
              <p role="alert" className="text-critical mt-2 text-sm">
                {serverVerdict(olderFailed)}
              </p>
            ) : null}
          </>
        )}
      </div>

      <MoveModal
        kind="TOPUP"
        open={topUp}
        onOpenChange={setTopUp}
        storeId={store.id}
        storeName={store.displayName ?? store.name}
      />
      <MoveModal
        kind="PAYOUT"
        open={payout}
        onOpenChange={setPayout}
        storeId={store.id}
        storeName={store.displayName ?? store.name}
      />
    </Section>
  );
}

function NegativeLimitForm({
  storeId,
  current,
  cap,
}: {
  readonly storeId: string;
  readonly current: string;
  readonly cap: string;
}): ReactElement {
  const toast = useToast();
  const set = useSetResellerStoreNegativeLimit();
  const [value, setValue] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const next = value.trim();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FormField
        label="How far below zero it may go (₹)"
        htmlFor="nl-amount"
        hint={
          <>
            Your risk: the store owes you whatever it spends below zero. At most{' '}
            <Money amount={cap} />.
          </>
        }
      >
        <Input
          id="nl-amount"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </FormField>
      <Button
        variant="secondary"
        size="md"
        disabled={set.isPending || next === current}
        onClick={() => setConfirming(true)}
      >
        Save
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Change how far below zero the store may go?"
        description={
          <>
            From <Money amount={current} /> to <Money amount={next === '' ? '0' : next} />. Whatever
            the store spends below zero is money it owes you — your risk, not Skydrop’s.
          </>
        }
        confirmLabel="Change the limit"
        disabled={set.isPending}
        onConfirm={async () => {
          try {
            await set.mutateAsync({ storeId, negativeLimitInr: next });
            toast.success('Saved.');
          } catch (err) {
            toast.error(serverVerdict(err));
          }
          setConfirming(false);
        }}
      />
    </div>
  );
}

function MoveModal({
  kind,
  open,
  onOpenChange,
  storeId,
  storeName,
}: {
  readonly kind: 'TOPUP' | 'PAYOUT';
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeId: string;
  readonly storeName: string;
}): ReactElement {
  const toast = useToast();
  const topUp = useTopUpResellerStore();
  const payout = useRecordResellerStorePayout();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // IDEM-1: one key per opening of the form, reused on a retry.
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());
  const busy = topUp.isPending || payout.isPending;

  function change(next: boolean): void {
    if (next) {
      setKey(crypto.randomUUID());
      setAmount('');
      setNote('');
      setError(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      if (kind === 'TOPUP') {
        await topUp.mutateAsync({
          storeId,
          amountInr: amount.trim(),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          idempotencyKey,
        });
        toast.success(`Moved the money to ${storeName}. It shows on the store’s ledger below.`);
      } else {
        await payout.mutateAsync({
          storeId,
          amountInr: amount.trim(),
          note: note.trim(),
          idempotencyKey,
        });
        toast.success(`Recorded paying ${storeName}. It shows on the store’s ledger below.`);
      }
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={kind === 'TOPUP' ? `Top up ${storeName}` : `Record paying ${storeName}`}
      description={
        kind === 'TOPUP'
          ? 'Moves money from your wallet into the store’s. You can move at most what you could withdraw.'
          : 'You paid the store yourself, outside Skydrop. Its wallet falls by this, and yours rises by the same.'
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField label="Amount (₹)" htmlFor="mv-amount" required>
          <Input
            id="mv-amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
        <FormField
          label={kind === 'TOPUP' ? 'Note (optional)' : 'How you paid it'}
          htmlFor="mv-note"
          hint="The store reads this."
          required={kind === 'PAYOUT'}
        >
          <Textarea
            id="mv-note"
            required={kind === 'PAYOUT'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={() => change(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy ? 'Saving…' : kind === 'TOPUP' ? 'Move the money' : 'Record it'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
