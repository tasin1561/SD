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
import { verdict } from '@/i18n/verdict';
import { RsError, RsSection, pendingPhase } from '../../_components/rs-parts';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import { dateTag } from '@/i18n/format';
import type { Locale } from '@skydrop/ui/app/i18n';

function when(iso: string, locale: Locale = 'en'): string {
  return new Date(iso).toLocaleString(dateTag(locale, 'en-IN'), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
  const locale = useLocale();
  const t = useT();
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
      title={t('resellerStoreDetail.theStoreSWallet')}
      note={
        store.walletManagedBy === 'SELLER'
          ? t('resellerStoreDetail.youManageItTop')
          : t('resellerStoreDetail.skydropManagesItThe')
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
              {t('resellerStoreDetail.topUp')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<HandCoins size={14} />}
              onClick={() => setPayout(true)}
            >
              {t('resellerStoreDetail.recordAPayout')}
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
          <ErrorState message={verdict(summary.error, t)} retry={() => void summary.refetch()} />
        ) : (
          <>
            {/* The two money cards take their `<Money>` as `figure`, so
                nothing re-formats them; only the plain count rolls up. */}
            <div className="rs-kpis">
              <KpiCard
                label={t('resellerStoreDetail.balance')}
                icon={<Wallet size={14} />}
                figure={<Money amount={summary.data.balanceInr} size="lg" />}
                tone={Number(summary.data.balanceInr) < 0 ? 'debit' : 'neutral'}
                hint={
                  Number(summary.data.balanceInr) < 0
                    ? t('resellerStoreDetail.belowZeroTheStore')
                    : undefined
                }
              />
              <KpiCard
                label={t('resellerStoreDetail.mayGoBelowZero')}
                icon={<Landmark size={14} />}
                figure={<Money amount={summary.data.negativeLimit.effectiveInr} size="lg" />}
                tone="neutral"
                hint={
                  <>
                    {richMessage(t('resellerStoreDetail.skydropAllowsUpTo'), {
                      money: <Money amount={summary.data.negativeLimit.capInr} />,
                    })}
                  </>
                }
              />
              <KpiCard
                label={t('resellerStoreDetail.waitingOnSkydrop')}
                icon={<Clock size={14} />}
                value={summary.data.pendingTopups.count + summary.data.pendingWithdrawals.count}
                tone="neutral"
                hint={t('resellerStoreDetail.theStoreSTop')}
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
          <SkeletonRows rows={3} cols={4} label={t('resellerStoreDetail.loadingTheLedger')} />
        ) : entries.isError ? (
          <ErrorState message={verdict(entries.error, t)} retry={() => void entries.refetch()} />
        ) : ledger.length === 0 ? (
          <EmptyState
            title={t('resellerStoreDetail.nothingHasMovedYet')}
            description={
              store.walletManagedBy === 'SELLER' && open
                ? t('resellerStoreDetail.topItUpTo')
                : undefined
            }
          />
        ) : (
          <div className="rs-stack rs-stack--tight">
            <Table caption={t('resellerStoreDetail.theStoreSWallet2')}>
              <THead>
                <Tr>
                  <Th>{t('resellerStoreDetail.when')}</Th>
                  <Th>{t('resellerStoreDetail.what')}</Th>
                  <Th align="right">{t('resellerStoreDetail.amount')}</Th>
                  <Th align="right">{t('resellerStoreDetail.balanceAfter')}</Th>
                </Tr>
              </THead>
              <TBody>
                {ledger.map((e) => {
                  const credit = isStoreWalletCredit(e.direction);
                  return (
                    <Tr key={e.id}>
                      <Td className="rs-when sk-figure">{when(e.createdAt, locale)}</Td>
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
                            {storeWalletDirectionLabel(e.direction, 'you', locale)}
                          </span>
                        </div>
                        {e.linkedOrderId !== null ? (
                          <Link href={`/orders/${e.linkedOrderId}`} className="rs-order-link">
                            {t('resellerStoreDetail.seeTheOrder')}
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
                  ? t('resellerStoreDetail.showingTheLatestMovements', { ledger: ledger.length })
                  : t('resellerStoreDetail.showingAllMovements', { ledger: ledger.length })}
              </p>
              {entries.hasNextPage ? (
                <AsyncButton
                  variant="secondary"
                  size="sm"
                  disabled={entries.isFetchingNextPage}
                  labels={{
                    idle: t('resellerStoreDetail.showOlder'),
                    busy: t('resellerStoreDetail.loading'),
                    done: t('resellerStoreDetail.loaded'),
                  }}
                  settleMs={600}
                  onAction={() => entries.fetchNextPage()}
                />
              ) : null}
            </div>
            {olderFailed !== null ? <RsError>{verdict(olderFailed, t)}</RsError> : null}
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
  const t = useT();
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
          label={t('resellerStoreDetail.howFarBelowZero')}
          hint={
            <>
              {richMessage(t('resellerStoreDetail.yourRiskTheStore'), {
                money: <Money amount={cap} />,
              })}
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
        {t('resellerStoreDetail.save')}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('resellerStoreDetail.changeHowFarBelow')}
        entity={storeName}
        amount={<Money amount={next === '' ? '0' : next} />}
        consequence={t('resellerStoreDetail.whateverTheStoreSpends')}
        confirmLabel={t('resellerStoreDetail.changeTheLimit')}
        closeOnSuccess={false}
        onConfirm={async () => {
          try {
            await set.mutateAsync({ storeId, negativeLimitInr: next });
            toast.success(t('resellerStoreDetail.saved'));
          } catch (err) {
            toast.error(verdict(err, t));
          }
          setConfirming(false);
        }}
      >
        <p className="rs-muted">
          {t('resellerStoreDetail.from')} <Money amount={current} /> to{' '}
          <Money amount={next === '' ? '0' : next} />.
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
  const t = useT();
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
        toast.success(t('resellerStoreDetail.movedTheMoneyTo', { storeName }));
      } else {
        await payout.mutateAsync({
          storeId,
          amountInr: amount.trim(),
          note: note.trim(),
          idempotencyKey,
        });
        toast.success(t('resellerStoreDetail.recordedPayingItShows', { storeName }));
      }
    } catch (err) {
      setError(verdict(err, t));
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
        title={
          kind === 'TOPUP'
            ? t('resellerStoreDetail.topUp2', { storeName })
            : t('resellerStoreDetail.recordPaying', { storeName })
        }
        description={
          kind === 'TOPUP'
            ? t('resellerStoreDetail.movesMoneyFromYour')
            : t('resellerStoreDetail.youPaidTheStore')
        }
        icon={kind === 'TOPUP' ? <Plus size={18} /> : <HandCoins size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => change(false)}>
              {t('resellerStoreDetail.cancel')}
            </Button>
            <AsyncButton
              type="submit"
              form={formId}
              variant="primary"
              size="md"
              state={pendingPhase(busy)}
              labels={{
                idle:
                  kind === 'TOPUP'
                    ? t('resellerStoreDetail.moveTheMoney')
                    : t('resellerStoreDetail.recordIt'),
                busy: t('resellerStoreDetail.saving'),
              }}
            />
          </DialogFooter>
        }
      >
        <form id={formId} onSubmit={review} className="rs-form">
          <TextField
            id="mv-amount"
            label={t('resellerStoreDetail.amount2')}
            inputMode="decimal"
            inputClassName="sk-figure"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextArea
            id="mv-note"
            label={
              kind === 'TOPUP'
                ? t('resellerStoreDetail.noteOptional')
                : t('resellerStoreDetail.howYouPaidIt')
            }
            hint={t('resellerStoreDetail.theStoreReadsThis')}
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
          kind === 'TOPUP'
            ? t('resellerStoreDetail.moveThisMoneyTo', { storeName })
            : t('resellerStoreDetail.recordPaying2', { storeName })
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
            ? t('resellerStoreDetail.itLeavesYourWallet')
            : t('resellerStoreDetail.theStoreSWallet3')
        }
        confirmLabel={
          kind === 'TOPUP'
            ? t('resellerStoreDetail.moveTheMoney')
            : t('resellerStoreDetail.recordIt')
        }
        cancelLabel={t('resellerStoreDetail.back')}
        onConfirm={submit}
        error={error}
      >
        {note.trim() !== '' ? (
          <p className="rs-muted">
            {kind === 'TOPUP'
              ? t('resellerStoreDetail.yourNote')
              : t('resellerStoreDetail.howYouPaidIt')}
            : {note.trim()}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
