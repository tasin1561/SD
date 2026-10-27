'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { AlertTriangle, ArrowLeftRight, BookMarked, ChevronRight, ShieldCheck } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { useBankEntries, useMarkOpeningBalance, useTreasuryOverview } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { MoSection, Notice } from './money-parts';
import { OwnerMoneyModal } from './owner-money-modal';
import { ReconcileModal } from './reconcile-modal';
import { TransferModal } from './transfer-modal';
import './treasury.css';
import { useT } from '@/i18n/client';

/**
 * What we hold, where, and how much of it is somebody else's.
 *
 * The seller wallet answers "what do we OWE". It says nothing about
 * whether the cash exists. This page answers the other half, and the two
 * together answer the only question that really matters about client
 * money: are we covered.
 *
 * Every balance here is SUMMED from entries, never cached. The wallet
 * cached its balance and left the refresh to each caller; six of
 * fourteen money paths remembered, and a seller owing ₹3,000 read as
 * ₹0.00 on an admin page. Money read wrong is worse than money read
 * slowly.
 */
/**
 * The magnitude of a money string, as a string.
 *
 * Not `Math.abs(Number(x))`: money is carried as a decimal STRING
 * throughout so it never touches a binary float, and parsing it here to
 * flip a sign would reintroduce exactly the rounding the convention
 * exists to avoid — on the figure that reports whether the money we
 * hold for sellers covers what we owe them.
 */
export function absAmount(v: string): string {
  return v.startsWith('-') ? v.slice(1) : v;
}

/** Zero however it is written: `0`, `0.00`, `-0.00`. */
export function isZeroAmount(v: string): boolean {
  return /^-?0*(\.0*)?$/.test(v.trim());
}

interface OpeningTarget {
  readonly id: string;
  readonly accountLabel: string;
  readonly signedAmount: string;
  readonly currency: 'INR' | 'BDT';
  readonly occurredAt: string;
}

export function TreasuryIndex(): ReactElement {
  const t = useT();
  const canManage = usePermission('money.treasury.manage');
  const overview = useTreasuryOverview();
  const [transferring, setTransferring] = useState(false);
  const [reconciling, setReconciling] = useState<{
    id: string;
    label: string;
    currency: 'INR' | 'BDT';
    capital: string;
    bySeller: ReadonlyArray<{ sellerId: string; companyName: string; amount: string }>;
  } | null>(null);
  const [ownerMoney, setOwnerMoney] = useState<{
    id: string;
    label: string;
    currency: 'INR' | 'BDT';
  } | null>(null);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const entries = useBankEntries({ limit: 50 }, true);
  const markOpening = useMarkOpeningBalance();
  const [markError, setMarkError] = useState<string | null>(null);
  // The entry being marked, while its reason is asked for. This used to
  // be a `window.prompt`; the dialog asks the same question and sends the
  // same request.
  const [marking, setMarking] = useState<OpeningTarget | null>(null);
  const [markReason, setMarkReason] = useState('');

  // An account whose real opening balance was written before the mark
  // existed (or by a flow) counts it as income on the P&L. The operator
  // says which entry it was; the server checks it is eligible, that the
  // account has none marked yet, and audits it.
  function askToMark(target: OpeningTarget): void {
    setMarkError(null);
    setMarkReason('');
    setMarking(target);
  }

  async function markAsOpening(entryId: string, reason: string): Promise<void> {
    setMarkError(null);
    try {
      await markOpening.mutateAsync({ entryId, reason: reason.trim() });
      setMarking(null);
    } catch (err) {
      setMarkError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <div className="mo-page">
      <PageHeader
        title={t('treasuryTreasuryIndex.treasury')}
        subtitle={t('treasuryTreasuryIndex.whichAccountHoldsWhatHow')}
        action={
          canManage ? (
            <Button
              variant="primary"
              size="sm"
              icon={<ArrowLeftRight size={14} />}
              onClick={() => setTransferring(true)}
            >
              {t('treasuryTreasuryIndex.moveMoney')}
            </Button>
          ) : undefined
        }
      />

      {overview.isLoading ? (
        <div className="mo-stack">
          <div className="tr-kpi-skel" aria-hidden>
            <Skeleton rounded="md" />
            <Skeleton rounded="md" />
            <Skeleton rounded="md" />
            <Skeleton rounded="md" />
          </div>
          <SkeletonRows rows={4} cols={7} label={t('treasuryTreasuryIndex.loadingTheTreasury')} />
        </div>
      ) : overview.isError || overview.data === undefined ? (
        <ErrorState
          message={overview.error?.message ?? t('treasuryTreasuryIndex.couldNotReadTheTreasury')}
          retry={() => void overview.refetch()}
        />
      ) : (
        <>
          {/* Client-money coverage first, because it is the one number
              on this page that can mean we are in trouble. */}
          <div className="mo-kpis">
            <KpiCard
              label={t('treasuryTreasuryIndex.owedToClients')}
              figure={<Money amount={overview.data.clientMoney.owedToSellersInr} currency="INR" />}
              hint={t('treasuryTreasuryIndex.sumOfPositiveWalletBalances')}
              tone="pending"
            />
            <KpiCard
              label={t('treasuryTreasuryIndex.heldForClients')}
              figure={<Money amount={overview.data.clientMoney.heldForSellersInr} currency="INR" />}
              hint={t('treasuryTreasuryIndex.cashInOurAccountsMarked')}
            />
            {/* The label and the number have to describe the SAME thing.
                `gapInr` is owed − held, so it is zero or negative when
                healthy — labelling that "Covered" put the most alarming
                figure on screen in the good case ("Covered ₹0.00"), and
                a real surplus read as "Covered −₹5,000.00". Show the
                magnitude, and let the label say which direction it is. */}
            <KpiCard
              label={
                overview.data.clientMoney.covered
                  ? t('treasuryTreasuryIndex.surplusHeld')
                  : t('treasuryTreasuryIndex.shortfall')
              }
              figure={
                // Magnitude WITHOUT a float round-trip: money is carried
                // as a string everywhere in this codebase precisely so it
                // is never handed to a binary float, and `Number(x)` here
                // would undo that for the one figure that says whether
                // client money is short.
                <Money amount={absAmount(overview.data.clientMoney.gapInr)} currency="INR" />
              }
              hint={
                overview.data.clientMoney.covered
                  ? isZeroAmount(overview.data.clientMoney.gapInr)
                    ? t('treasuryTreasuryIndex.exactlyCoveredWeHoldWhat')
                    : t('treasuryTreasuryIndex.heldForClientsOverAnd')
                  : t('treasuryTreasuryIndex.weOweMoreThanWe')
              }
              tone={overview.data.clientMoney.covered ? 'credit' : 'debit'}
              icon={
                overview.data.clientMoney.covered ? (
                  <ShieldCheck size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )
              }
            />
            {/* Not in any bank account, and easy to forget it is ours
                at all: the recharge debited the account when it was
                recorded, so without this line the money reads as spent.
                Links out rather than expanding here — reconciling it is
                its own page and its own question. */}
            {Number(overview.data.courierWallets.totalInr) > 0 ||
            overview.data.courierWallets.accounts.length > 0 ? (
              <Link href="/courier-wallet" className="tr-kpi-link">
                <KpiCard
                  label={t('treasuryTreasuryIndex.inCourierWallets')}
                  figure={
                    <Money
                      amount={overview.data.courierWallets.totalInr}
                      currency="INR"
                      convert={false}
                    />
                  }
                  hint={t('treasuryTreasuryIndex.prepaidFloatOursHeldOn')}
                  tone="info"
                />
              </Link>
            ) : null}
            {overview.data.totals.byCurrency.map((c) => (
              <KpiCard
                key={c.currency}
                label={t('treasuryTreasuryIndex.total2', { currency: c.currency })}
                figure={<Money amount={c.total} currency={c.currency} convert={false} />}
                hint={
                  // Through Money, like every other figure on the page.
                  // Interpolated into the string these rendered as bare
                  // `100000.00` under a headline reading `৳1,00,000.00`
                  // — the same amount, twice, formatted two ways, which
                  // is exactly what the Money primitive exists to stop.
                  <>
                    Ours <Money amount={c.capital} currency={c.currency} convert={false} /> · held{' '}
                    <Money amount={c.sellerHeld} currency={c.currency} convert={false} />
                  </>
                }
              />
            ))}
          </div>

          {!overview.data.clientMoney.covered && (
            <Notice tone="bad" icon={<AlertTriangle size={16} />} role="status">
              <p>{t('treasuryTreasuryIndex.weOweClientsMoreThan')}</p>
            </Notice>
          )}

          <MoSection
            title={t('treasuryTreasuryIndex.accounts')}
            note={t('treasuryTreasuryIndex.openOneToSeeWhose')}
            flush
          >
            <Table caption={t('treasuryTreasuryIndex.ourBankAccounts')}>
              <THead>
                <Tr>
                  <Th>{t('treasuryTreasuryIndex.account')}</Th>
                  <Th>{t('treasuryTreasuryIndex.purpose')}</Th>
                  <Th>{t('treasuryTreasuryIndex.settlesFrom')}</Th>
                  <Th align="right">{t('treasuryTreasuryIndex.ours')}</Th>
                  <Th align="right">{t('treasuryTreasuryIndex.heldForClients')}</Th>
                  <Th align="right">{t('treasuryTreasuryIndex.total')}</Th>
                  <Th align="right">{t('treasuryTreasuryIndex.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {overview.data.accounts.length === 0 ? (
                  <TableEmpty colSpan={7}>
                    <EmptyState
                      bare
                      title={t('treasuryTreasuryIndex.noBankAccountsYet')}
                      description={t('treasuryTreasuryIndex.addOneOnTheBank')}
                    />
                  </TableEmpty>
                ) : (
                  overview.data.accounts.map((a) => (
                    <Tr key={a.accountId}>
                      <Td>
                        <button
                          type="button"
                          className="tr-account"
                          aria-expanded={openAccount === a.accountId}
                          onClick={() =>
                            setOpenAccount(openAccount === a.accountId ? null : a.accountId)
                          }
                        >
                          <ChevronRight size={14} aria-hidden className="tr-account__chev" />
                          <span>
                            <span className="tr-account__name">{a.label}</span>
                            <span className="tr-account__sub">
                              {a.bankName} · {a.currency}
                            </span>
                          </span>
                        </button>
                        {openAccount === a.accountId &&
                          (a.bySeller.length === 0 ? (
                            <p className="mo-faint tr-holders">
                              {t('treasuryTreasuryIndex.nothingInHereBelongsTo')}
                            </p>
                          ) : (
                            <dl className="tr-holders">
                              {a.bySeller.map((s) => (
                                <div key={s.sellerId} className="tr-holders__row">
                                  <dt>{s.companyName}</dt>
                                  <dd>
                                    <Money
                                      amount={s.amount}
                                      currency={a.currency}
                                      convert={false}
                                    />
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ))}
                      </Td>
                      <Td className="mo-muted">{a.purpose ?? '—'}</Td>
                      <Td className="mo-muted">{a.courierAccountLabel ?? '—'}</Td>
                      <Td align="right">
                        <Money amount={a.capital} currency={a.currency} convert={false} />
                      </Td>
                      <Td align="right">
                        <Money amount={a.sellerHeld} currency={a.currency} convert={false} />
                      </Td>
                      <Td align="right">
                        <Money amount={a.total} currency={a.currency} convert={false} />
                      </Td>
                      <Td align="right">
                        {canManage ? (
                          <div className="tr-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setOwnerMoney({
                                  id: a.accountId,
                                  label: a.label,
                                  currency: a.currency,
                                })
                              }
                            >
                              {t('treasuryTreasuryIndex.ownerMoney')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setReconciling({
                                  id: a.accountId,
                                  label: a.label,
                                  currency: a.currency,
                                  capital: a.capital,
                                  bySeller: a.bySeller,
                                })
                              }
                            >
                              {t('treasuryTreasuryIndex.reconcile')}
                            </Button>
                          </div>
                        ) : (
                          <span className="mo-faint">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </MoSection>

          <MoSection
            title={t('treasuryTreasuryIndex.recentMovements')}
            note={t('treasuryTreasuryIndex.appendOnlyACorrectionIs')}
            flush
          >
            {entries.isError ? (
              <div className="mo-card__pad">
                <ErrorState
                  message={
                    entries.error?.message ?? t('treasuryTreasuryIndex.couldNotReadTheLedger')
                  }
                  retry={() => void entries.refetch()}
                />
              </div>
            ) : entries.isLoading ? (
              <div className="mo-card__pad">
                <SkeletonRows
                  rows={5}
                  cols={6}
                  label={t('treasuryTreasuryIndex.loadingRecentMovements')}
                />
              </div>
            ) : (
              <Table caption={t('treasuryTreasuryIndex.recentBankMovements')}>
                <THead>
                  <Tr>
                    <Th>{t('treasuryTreasuryIndex.when')}</Th>
                    <Th>{t('treasuryTreasuryIndex.account')}</Th>
                    <Th>{t('treasuryTreasuryIndex.what')}</Th>
                    <Th>{t('treasuryTreasuryIndex.whose')}</Th>
                    <Th align="right">{t('treasuryTreasuryIndex.amount')}</Th>
                    <Th align="right">{t('treasuryTreasuryIndex.openingBalance')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(entries.data?.items ?? []).length === 0 ? (
                    <TableEmpty colSpan={6}>
                      <EmptyState
                        bare
                        title={t('treasuryTreasuryIndex.nothingRecordedYet')}
                        description={t('treasuryTreasuryIndex.settlementsTopUpsAndPayouts')}
                      />
                    </TableEmpty>
                  ) : (
                    (entries.data?.items ?? []).map((e) => (
                      <Tr key={e.id}>
                        <Td className="mo-muted mo-nowrap">
                          {new Date(e.occurredAt).toLocaleString()}
                        </Td>
                        <Td>{e.accountLabel}</Td>
                        <Td>
                          {e.type.replaceAll('_', ' ').toLowerCase()}
                          {e.categoryName !== null && (
                            <span className="mo-faint"> · {e.categoryName}</span>
                          )}
                        </Td>
                        <Td className="mo-muted">
                          {e.ownerKind === 'CAPITAL'
                            ? t('treasuryTreasuryIndex.ours')
                            : (e.sellerName ?? t('treasuryTreasuryIndex.aClient'))}
                        </Td>
                        <Td align="right">
                          {/* Sign carries the direction, so a debit and a
                              credit cannot be told apart by colour alone. */}
                          <Money amount={e.signedAmount} currency={e.currency} convert={false} />
                        </Td>
                        <Td align="right">
                          {e.isOpeningBalance ? (
                            <StatusChip
                              kind="confirmed"
                              label={t('treasuryTreasuryIndex.openingBalance')}
                              size="sm"
                            />
                          ) : canManage &&
                            e.ownerKind === 'CAPITAL' &&
                            (e.type === 'RECONCILIATION_ADJUSTMENT' ||
                              e.type === 'OPENING_BALANCE') ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<BookMarked size={14} />}
                              disabled={markOpening.isPending}
                              onClick={() =>
                                askToMark({
                                  id: e.id,
                                  accountLabel: e.accountLabel,
                                  signedAmount: e.signedAmount,
                                  currency: e.currency,
                                  occurredAt: e.occurredAt,
                                })
                              }
                            >
                              {t('treasuryTreasuryIndex.markAsOpeningBalance')}
                            </Button>
                          ) : null}
                        </Td>
                      </Tr>
                    ))
                  )}
                </TBody>
              </Table>
            )}
          </MoSection>

          {overview.data.clientMoney.covered && overview.data.accounts.length > 0 && (
            <p className="tr-covered">
              <ShieldCheck size={14} aria-hidden />
              {t('treasuryTreasuryIndex.clientMoneyIsCoveredBy')}
            </p>
          )}

          <div>
            <StatusChip kind="draft" label={t('treasuryTreasuryIndex.phase1b')} size="sm" />
          </div>
        </>
      )}

      <Dialog
        open={marking !== null}
        onOpenChange={(next) => {
          if (!next) {
            setMarking(null);
            setMarkError(null);
          }
        }}
        icon={<BookMarked size={18} />}
        title={t('treasuryTreasuryIndex.markAsTheOpeningBalance')}
        description={t('treasuryTreasuryIndex.thePLLeavesThe')}
        locked={markOpening.isPending}
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setMarking(null)}
              disabled={markOpening.isPending}
            >
              {t('treasuryTreasuryIndex.cancel')}
            </Button>
            <AsyncButton
              labels={{
                idle: t('treasuryTreasuryIndex.markAsOpeningBalance'),
                busy: t('treasuryTreasuryIndex.marking'),
                done: t('treasuryTreasuryIndex.marked'),
              }}
              onAction={() =>
                marking === null ? Promise.resolve() : markAsOpening(marking.id, markReason)
              }
            />
          </DialogFooter>
        }
      >
        {marking !== null && (
          <div className="mo-fields">
            <dl className="mo-facts">
              <dt>{t('treasuryTreasuryIndex.account')}</dt>
              <dd>{marking.accountLabel}</dd>
              <dt>{t('treasuryTreasuryIndex.entry')}</dt>
              <dd>
                <Money amount={marking.signedAmount} currency={marking.currency} convert={false} />
                <span className="mo-sub">{new Date(marking.occurredAt).toLocaleString()}</span>
              </dd>
            </dl>
            <TextArea
              id="treasury-opening-reason"
              label={t('treasuryTreasuryIndex.whyIsThisTheMoney')}
              hint={t('treasuryTreasuryIndex.atLeast10CharactersKept')}
              value={markReason}
              onChange={(ev) => setMarkReason(ev.target.value)}
              rows={3}
              autoFocus
            />
            {markError !== null && (
              <p className="mo-error" role="alert">
                {markError}
              </p>
            )}
          </div>
        )}
      </Dialog>

      <TransferModal open={transferring} onOpenChange={setTransferring} />
      <OwnerMoneyModal
        accountId={ownerMoney?.id ?? null}
        accountLabel={ownerMoney?.label ?? ''}
        currency={ownerMoney?.currency ?? 'INR'}
        onClose={() => setOwnerMoney(null)}
      />
      <ReconcileModal
        accountId={reconciling?.id ?? null}
        accountLabel={reconciling?.label ?? ''}
        currency={reconciling?.currency ?? 'INR'}
        bookBalance={reconciling?.capital ?? '0'}
        bySeller={reconciling?.bySeller ?? []}
        onClose={() => setReconciling(null)}
      />
    </div>
  );
}
