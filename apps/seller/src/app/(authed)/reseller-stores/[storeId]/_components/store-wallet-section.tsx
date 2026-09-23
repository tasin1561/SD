'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  HandCoins,
  Landmark,
  Plus,
  Wallet,
} from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
// The legacy toast, on purpose: this section's behaviour test mounts only
// the legacy `<Toaster>`, and the app `useToast` throws outside its own
// provider. The authed shell mounts both, so in the app they look alike.
import { Money, useToast } from '@skydrop/ui/components';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
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
import { RsError, RsSection, pendingPhase } from '../../_components/rs-parts';

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
  const storeName = store.displayName ?? store.name;

  return (
    <RsSection
      title="The store’s wallet"
      note={
        store.walletManagedBy === 'SELLER'
          ? 'You manage it: top it up from your own wallet, and record paying the store.'
          : 'Skydrop manages it: the store tops up to us and withdraws through us.'
      }
      action={
        open && store.walletManagedBy === 'SELLER' ? (
          <span className="rs-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setTopUp(true)}
            >
              Top up
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<HandCoins size={14} />}
              onClick={() => setPayout(true)}
            >
              Record a payout
            </Button>
          </span>
        ) : undefined
      }
    >
      <div className="rs-stack">
        {summary.isPending ? (
          <div className="rs-kpis">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
            ))}
          </div>
        ) : summary.isError ? (
          <ErrorState message={serverVerdict(summary.error)} retry={() => void summary.refetch()} />
        ) : (
          <>
            {/* The two money cards take their `<Money>` as `figure`, so
                nothing re-formats them; only the plain count rolls up. */}
            <div className="rs-kpis">
              <KpiCard
                label="Balance"
                icon={<Wallet size={14} />}
                figure={<Money amount={summary.data.balanceInr} size="lg" />}
                tone={Number(summary.data.balanceInr) < 0 ? 'debit' : 'neutral'}
                hint={
                  Number(summary.data.balanceInr) < 0
                    ? 'Below zero: the store owes you this, and it comes off what you can withdraw.'
                    : undefined
                }
              />
              <KpiCard
                label="May go below zero by"
                icon={<Landmark size={14} />}
                figure={<Money amount={summary.data.negativeLimit.effectiveInr} size="lg" />}
                tone="neutral"
                hint={
                  <>
                    Skydrop allows up to <Money amount={summary.data.negativeLimit.capInr} /> for
                    your account.
                  </>
                }
              />
              <KpiCard
                label="Waiting on Skydrop"
                icon={<Clock size={14} />}
                value={summary.data.pendingTopups.count + summary.data.pendingWithdrawals.count}
                tone="neutral"
                hint="The store’s top-ups and withdrawals Skydrop has not settled yet."
              />
            </div>
            {open ? (
              <NegativeLimitForm
                storeId={store.id}
                storeName={storeName}
                current={summary.data.negativeLimit.ownInr}
                cap={summary.data.negativeLimit.capInr}
              />
            ) : null}
          </>
        )}

        {entries.isPending ? (
          <SkeletonRows rows={3} cols={4} label="Loading the ledger" />
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
          <div className="rs-stack rs-stack--tight">
            <Table caption="The store’s wallet ledger">
              <THead>
                <Tr>
                  <Th>When</Th>
                  <Th>What</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Balance after</Th>
                </Tr>
              </THead>
              <TBody>
                {ledger.map((e) => {
                  const credit = isStoreWalletCredit(e.direction);
                  return (
                    <Tr key={e.id}>
                      <Td className="rs-when sk-figure">{when(e.createdAt)}</Td>
                      <Td>
                        {/* Which way the money went: an arrow chip beside
                            the sign and colour the figure already carries. */}
                        <div className="rs-row">
                          <span
                            className="rs-dir"
                            data-dir={credit ? 'credit' : 'debit'}
                            aria-hidden
                          >
                            {credit ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                          </span>
                          <span className="rs-body">
                            {storeWalletDirectionLabel(e.direction, 'you')}
                          </span>
                        </div>
                        {e.linkedOrderId !== null ? (
                          <Link href={`/orders/${e.linkedOrderId}`} className="rs-order-link">
                            See the order
                          </Link>
                        ) : null}
                        {e.note !== null ? <div className="rs-faint">{e.note}</div> : null}
                      </Td>
                      <Td align="right">
                        <Money amount={e.amountInr} direction={credit ? 'credit' : 'debit'} />
                      </Td>
                      <Td align="right">
                        <Money amount={e.runningBalanceAfterInr} />
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
            <div className="rs-row rs-row--between">
              <p className="rs-faint">
                {entries.hasNextPage
                  ? `Showing the latest ${ledger.length} movements.`
                  : `Showing all ${ledger.length} movements.`}
              </p>
              {entries.hasNextPage ? (
                <AsyncButton
                  variant="secondary"
                  size="sm"
                  disabled={entries.isFetchingNextPage}
                  labels={{ idle: 'Show older', busy: 'Loading…', done: 'Loaded' }}
                  settleMs={600}
                  onAction={() => entries.fetchNextPage()}
                />
              ) : null}
            </div>
            {olderFailed !== null ? <RsError>{serverVerdict(olderFailed)}</RsError> : null}
          </div>
        )}
      </div>

      <MoveModal
        kind="TOPUP"
        open={topUp}
        onOpenChange={setTopUp}
        storeId={store.id}
        storeName={storeName}
      />
      <MoveModal
        kind="PAYOUT"
        open={payout}
        onOpenChange={setPayout}
        storeId={store.id}
        storeName={storeName}
      />
    </RsSection>
  );
}

function NegativeLimitForm({
  storeId,
  storeName,
  current,
  cap,
}: {
  readonly storeId: string;
  readonly storeName: string;
  readonly current: string;
  readonly cap: string;
}): ReactElement {
  const toast = useToast();
  const set = useSetResellerStoreNegativeLimit();
  const [value, setValue] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const next = value.trim();
  return (
    <div className="rs-row rs-row--end">
      <div className="rs-inline-field">
        <TextField
          id="nl-amount"
          label="How far below zero it may go (₹)"
          hint={
            <>
              Your risk: the store owes you whatever it spends below zero. At most{' '}
              <Money amount={cap} />.
            </>
          }
          inputMode="decimal"
          inputClassName="sk-figure"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
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
        entity={storeName}
        amount={<Money amount={next === '' ? '0' : next} />}
        consequence="Whatever the store spends below zero is money it owes you — your risk, not Skydrop’s."
        confirmLabel="Change the limit"
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await set.mutateAsync({ storeId, negativeLimitInr: next });
            toast.success('Saved.');
          } catch (err) {
            toast.error(serverVerdict(err));
          }
          setConfirming(false);
        }}
      >
        <p className="rs-muted">
          From <Money amount={current} /> to <Money amount={next === '' ? '0' : next} />.
        </p>
      </ConfirmDialog>
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
  /**
   * The owner's rule: money moving between you and a store is confirmed
   * on a second screen that restates the store, the amount and what
   * happens — and only then does the SAME request fire, with the SAME
   * idempotency key. The form's own button opens that screen.
   */
  const [confirming, setConfirming] = useState(false);
  const formId = kind === 'TOPUP' ? 'rs-topup-form' : 'rs-payout-form';
  const typed = amount.trim();

  function change(next: boolean): void {
    if (next) {
      setKey(crypto.randomUUID());
      setAmount('');
      setNote('');
      setError(null);
    }
    onOpenChange(next);
  }

  function review(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setConfirming(true);
  }

  async function submit(): Promise<void> {
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
    } catch (err) {
      setError(serverVerdict(err));
      // Rethrown so the confirmation stays open with the verdict on it.
      throw err;
    }
    setConfirming(false);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={change}
        title={kind === 'TOPUP' ? `Top up ${storeName}` : `Record paying ${storeName}`}
        description={
          kind === 'TOPUP'
            ? 'Moves money from your wallet into the store’s. You can move at most what you could withdraw.'
            : 'You paid the store yourself, outside Skydrop. Its wallet falls by this, and yours rises by the same.'
        }
        icon={kind === 'TOPUP' ? <Plus size={18} /> : <HandCoins size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => change(false)}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              form={formId}
              variant="primary"
              size="md"
              state={pendingPhase(busy)}
              labels={{
                idle: kind === 'TOPUP' ? 'Move the money' : 'Record it',
                busy: 'Saving…',
              }}
            />
          </DialogFooter>
        }
      >
        <form id={formId} onSubmit={review} className="rs-form">
          <TextField
            id="mv-amount"
            label="Amount (₹)"
            inputMode="decimal"
            inputClassName="sk-figure"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextArea
            id="mv-note"
            label={kind === 'TOPUP' ? 'Note (optional)' : 'How you paid it'}
            hint="The store reads this."
            required={kind === 'PAYOUT'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error !== null && !confirming ? <RsError>{error}</RsError> : null}
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          kind === 'TOPUP' ? `Move this money to ${storeName}?` : `Record paying ${storeName}?`
        }
        entity={storeName}
        amount={
          typed !== '' && Number.isFinite(Number(typed)) ? (
            <Money amount={typed} size="md" />
          ) : (
            typed
          )
        }
        consequence={
          kind === 'TOPUP'
            ? 'It leaves your wallet and lands in the store’s straight away.'
            : 'The store’s wallet falls by this, and yours rises by the same.'
        }
        confirmLabel={kind === 'TOPUP' ? 'Move the money' : 'Record it'}
        cancelLabel="Back"
        onConfirm={submit}
        error={error}
      >
        {note.trim() !== '' ? (
          <p className="rs-muted">
            {kind === 'TOPUP' ? 'Your note' : 'How you paid it'}: {note.trim()}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
