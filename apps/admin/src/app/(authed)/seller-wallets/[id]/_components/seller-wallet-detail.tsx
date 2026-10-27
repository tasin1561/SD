'use client';

import { startTransition, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Landmark, Scale } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Tabs } from '@skydrop/ui/app/tabs';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import {
  useSellerWalletDetail,
  useSellerWalletEntries,
  useSellerWalletTopups,
  useSellerWalletWithdrawals,
  type AdminWalletEntry,
} from '@/lib/seller-wallet-hooks';
import { isWalletCredit, walletDirectionLabel } from '@skydrop/ui/status';
import type { WalletEntryDirection } from '@skydrop/db';
import { useInstantPayAdvances, useSellerHoldings } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { MoveSellerCashModal, type HoldingRef } from './move-seller-cash-modal';
import { MkCard } from '../../_components/money-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * One seller's wallet, from our side — the same three views they have,
 * without the two buttons that move money.
 *
 * Read-only deliberately. An operator looking at a balance and an
 * operator changing one are different jobs, and a page that does both is
 * one where a mis-click looks like a report.
 */
export function SellerWalletDetailView({ sellerId }: { readonly sellerId: string }): ReactElement {
  const t = useT();

  // The bank book is a narrower permission than the wallet — gated here
  // rather than left to 403, so somebody without it sees a page that
  // works instead of one that looks broken.
  const canReadTreasury = usePermission('money.treasury.view');
  // Cosmetic (FE-2): the server refuses a correction without it regardless.
  const canManageTreasury = usePermission('money.treasury.manage');
  const [moving, setMoving] = useState<HoldingRef | null>(null);
  const detail = useSellerWalletDetail(sellerId);
  const entries = useSellerWalletEntries(sellerId);
  const topups = useSellerWalletTopups(sellerId);
  const withdrawals = useSellerWalletWithdrawals(sellerId);
  const holdings = useSellerHoldings(canReadTreasury ? sellerId : null);
  // Same treasury gate: skipped rather than 403'd for anybody without it.
  const advances = useInstantPayAdvances({ sellerId }, canReadTreasury);
  const [tab, setTab] = useState<'ledger' | 'topups' | 'withdrawals'>('ledger');

  if (detail.isLoading) {
    return (
      <div className="mk-page">
        <Skeleton height={56} rounded="md" />
        <div className="mk-kpis">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={132} rounded="md" />
          ))}
        </div>
        <SkeletonRows
          rows={6}
          cols={5}
          label={t('sellerWalletsIdSellerWalletDetail.loadingWallet')}
        />
      </div>
    );
  }
  if (detail.isError || detail.data === undefined) {
    return (
      <ErrorState
        message={detail.error?.message ?? t('sellerWalletsIdSellerWalletDetail.failedToLoad')}
        retry={() => void detail.refetch()}
      />
    );
  }
  const d = detail.data;

  return (
    <div className="mk-page">
      <PageHeader
        breadcrumb={
          <Link href="/seller-wallets" className="mk-link">
            <ArrowLeft size={14} aria-hidden /> {t('sellerWalletsIdSellerWalletDetail.allWallets')}
          </Link>
        }
        title={d.seller.companyName}
        subtitle={`${d.seller.email} · ${d.seller.status}`}
      />

      {/* The figures that make each other up, rather than one number the
          reader has to trust. Balance is what the ledger says; available
          is what could actually leave today. */}
      <div className="mk-kpis">
        <KpiCard
          label={t('sellerWalletsIdSellerWalletDetail.balance')}
          figure={<Money amount={d.balanceInr} currency="INR" />}
          hint={
            Number(d.balanceInr) < 0
              ? t('sellerWalletsIdSellerWalletDetail.theyOweUs')
              : t('sellerWalletsIdSellerWalletDetail.weOweThem')
          }
          tone={Number(d.balanceInr) < 0 ? 'debit' : 'neutral'}
        />
        <KpiCard
          label={t('sellerWalletsIdSellerWalletDetail.availableToWithdraw')}
          figure={<Money amount={d.withdrawableInr} currency="INR" />}
          hint={t('sellerWalletsIdSellerWalletDetail.balanceLessTheFloorAnd')}
        />
        <KpiCard
          label={t('sellerWalletsIdSellerWalletDetail.requestedNotYetPaid')}
          figure={<Money amount={d.pendingWithdrawalInr} currency="INR" />}
          hint={t('sellerWalletsIdSellerWalletDetail.stillInTheBalanceHeld')}
          tone="pending"
        />
        <KpiCard
          label={t('sellerWalletsIdSellerWalletDetail.topUpsAwaitingReview')}
          figure={<Money amount={d.pendingTopupInr} currency="INR" />}
          hint={t('sellerWalletsIdSellerWalletDetail.claimedNotMatchedToA')}
        />
      </div>

      {/* Money we paid this seller before the courier paid us (Instant
          Pay). It is inside their balance above; what this adds is that
          the courier still owes it to US. */}
      {canReadTreasury &&
        (advances.isError ? (
          <p className="mk-muted">
            {t('sellerWalletsIdSellerWalletDetail.couldNotReadInstantPay')}{' '}
            <button
              type="button"
              className="mk-inline-link"
              onClick={() => void advances.refetch()}
            >
              {t('sellerWalletsIdSellerWalletDetail.retry')}
            </button>
          </p>
        ) : advances.data !== undefined ? (
          <p className="mk-muted">
            <span>{t('sellerWalletsIdSellerWalletDetail.advancedViaInstantPayAwaiting')} </span>
            <span className="mk-body">
              <Money amount={advances.data.totalCodInr} currency="INR" convert={false} />
            </span>{' '}
            ({advances.data.count} {advances.data.count === 1 ? 'order' : 'orders'})
            {advances.data.count > 0 && (
              <>
                {' '}
                <Link
                  href={`/liabilities/instant-pay?sellerId=${sellerId}`}
                  className="mk-inline-link"
                >
                  {t('sellerWalletsIdSellerWalletDetail.seeOrders')}
                </Link>
              </>
            )}
          </p>
        ) : null)}

      {/* Where the money physically is, which the balance above does not
          say. The wallet is what we OWE them; this is which of our
          accounts the cash is sitting in — the question a payout has to
          answer before it can be made, because paying BDT out of an
          account holding only INR is not something a balance can warn
          you about. */}
      <MkCard
        title={t('sellerWalletsIdSellerWalletDetail.whereTheirMoneyIsHeld')}
        icon={<Landmark size={18} />}
      >
        {holdings.isLoading ? (
          <p className="mk-muted">{t('sellerWalletsIdSellerWalletDetail.readingTheBankBook')}</p>
        ) : holdings.isError || holdings.data === undefined ? (
          <p className="mk-muted">{t('sellerWalletsIdSellerWalletDetail.couldNotReadTheBank')}</p>
        ) : holdings.data.length === 0 ? (
          <p className="mk-muted">
            {t('sellerWalletsIdSellerWalletDetail.noCashIsRecordedAgainst')}
          </p>
        ) : (
          <dl className="mk-dl">
            {holdings.data.map((h) => (
              <div key={`${h.accountId}-${h.currency}`} className="mk-dl__row">
                <dt>
                  {h.label} · {h.currency}
                </dt>
                <dd>
                  <Money amount={h.amount} currency={h.currency} convert={false} />
                  {canManageTreasury && (
                    <button
                      type="button"
                      className="mk-inline-link mk-small"
                      onClick={() => setMoving(h)}
                    >
                      {t('sellerWalletsIdSellerWalletDetail.correct')}
                    </button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </MkCard>
      <MoveSellerCashModal sellerId={sellerId} holding={moving} onClose={() => setMoving(null)} />

      {Number(d.minimumBalanceInr) > 0 && (
        <p className="mk-small">
          {richMessage(t('sellerWalletsIdSellerWalletDetail.thisAccountMustLeaveIn'), {
            money: <Money amount={d.minimumBalanceInr} currency="INR" />,
          })}
        </p>
      )}

      {/* The rules actually in force for this seller — resolved, so the
          number shown is the one being applied rather than the two
          places it might have come from (SET-1). Read-only: they are
          edited where they are owned. */}
      <MkCard
        title={t('sellerWalletsIdSellerWalletDetail.walletRulesForThisClient')}
        subtitle={t('sellerWalletsIdSellerWalletDetail.whatIsInForceRight')}
        icon={<Scale size={18} />}
        aside={
          <Link href="/settings" className="mk-link">
            {t('sellerWalletsIdSellerWalletDetail.editDefaults')}{' '}
            <ArrowRight size={14} aria-hidden />
          </Link>
        }
      >
        <dl className="mk-dl mk-dl--grid">
          {d.settings.map((st) => (
            <div key={st.key} className="mk-dl__row">
              <dt>
                <span className="mk-body">{st.label}</span>
                {st.hint !== '' && <div className="mk-faint">{st.hint}</div>}
              </dt>
              <dd>
                <span className="mk-strong sk-figure">{st.value}</span>
                {st.source === 'SELLER_OVERRIDE' && <span className="mk-tag">override</span>}
              </dd>
            </div>
          ))}
        </dl>
      </MkCard>

      <Tabs
        label={t('sellerWalletsIdSellerWalletDetail.walletHistory')}
        value={tab}
        onChange={(id) =>
          // A transition: the tab answers the click at once and the
          // hundred-row ledger re-renders just after (INP, Phase 6).
          startTransition(() => setTab(id as 'ledger' | 'topups' | 'withdrawals'))
        }
        items={[
          {
            id: 'ledger',
            label: t('sellerWalletsIdSellerWalletDetail.ledger'),
            panel: (
              <MkCard
                flush
                title={t('sellerWalletsIdSellerWalletDetail.ledger')}
                subtitle={t('sellerWalletsIdSellerWalletDetail.everyEntryNewestFirstOnly')}
              >
                <Table caption={t('sellerWalletsIdSellerWalletDetail.ledger')}>
                  <THead>
                    <Tr>
                      <Th>{t('sellerWalletsIdSellerWalletDetail.when')}</Th>
                      <Th>{t('sellerWalletsIdSellerWalletDetail.type')}</Th>
                      <Th>{t('sellerWalletsIdSellerWalletDetail.linked')}</Th>
                      <Th align="right">{t('sellerWalletsIdSellerWalletDetail.amount')}</Th>
                      <Th align="right">{t('sellerWalletsIdSellerWalletDetail.balanceAfter')}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {(entries.data?.items ?? []).length === 0 ? (
                      <TableEmpty colSpan={5}>
                        {t('sellerWalletsIdSellerWalletDetail.noEntriesYet')}
                      </TableEmpty>
                    ) : (
                      (entries.data?.items ?? []).map((e: AdminWalletEntry) => (
                        <Tr key={e.id}>
                          <Td className="mk-when sk-figure">
                            {new Date(e.createdAt).toLocaleString()}
                          </Td>
                          <Td>
                            {/* The raw enum was on screen: ORDER_CHARGES,
                                INSTANT_PAY_FEE. Staff answering "why is my
                                balance this" were reading the column name
                                out of the database. */}
                            <div className="mk-cell">
                              <span className="mk-body">
                                {walletDirectionLabel(e.direction as WalletEntryDirection)}
                              </span>
                              {e.note !== null && <span className="mk-faint">{e.note}</span>}
                            </div>
                          </Td>
                          {/* Staff reading a disputed balance had no route
                              from an entry to what it charged for: the id was
                              in the payload and nothing rendered it. */}
                          <Td>
                            {e.linkedOrderId !== null ? (
                              <Link
                                href={`/orders/${e.linkedOrderId}`}
                                className="mk-inline-link sk-ident mk-small"
                              >
                                {e.linkedOrderNumber ??
                                  t('sellerWalletsIdSellerWalletDetail.order')}{' '}
                                →
                              </Link>
                            ) : e.linkedConsignmentId !== null ? (
                              <Link
                                href={`/warehouse/consignments/${e.linkedConsignmentId}`}
                                className="mk-inline-link sk-ident mk-small"
                              >
                                {e.linkedConsignmentNumber ??
                                  t('sellerWalletsIdSellerWalletDetail.consignment')}{' '}
                                →
                              </Link>
                            ) : (
                              <span className="mk-faint">—</span>
                            )}
                          </Td>
                          <Td align="right">
                            {/* Without a direction every figure rendered the
                                same, so a refund and a charge were
                                indistinguishable on a money screen. The sign
                                carries it as well as the colour — colour
                                alone is not a difference everybody can see. */}
                            <Money
                              amount={e.amount}
                              currency="INR"
                              direction={
                                isWalletCredit(e.direction as WalletEntryDirection)
                                  ? 'credit'
                                  : 'debit'
                              }
                            />
                          </Td>
                          <Td align="right">
                            <Money amount={e.runningBalanceAfter} currency="INR" />
                          </Td>
                        </Tr>
                      ))
                    )}
                  </TBody>
                </Table>
              </MkCard>
            ),
          },
          {
            id: 'topups',
            label: t('sellerWalletsIdSellerWalletDetail.topUps'),
            panel: (
              <MkCard
                flush
                title={t('sellerWalletsIdSellerWalletDetail.topUps')}
                subtitle={t('sellerWalletsIdSellerWalletDetail.everyClaimWhateverBecameOf')}
              >
                <RawList
                  rows={topups.data ?? []}
                  empty={t('sellerWalletsIdSellerWalletDetail.noTopUpsClaimed')}
                />
              </MkCard>
            ),
          },
          {
            id: 'withdrawals',
            label: t('sellerWalletsIdSellerWalletDetail.withdrawalRequests'),
            panel: (
              <MkCard
                flush
                title={t('sellerWalletsIdSellerWalletDetail.withdrawalRequests')}
                subtitle={t('sellerWalletsIdSellerWalletDetail.aRequestNeverMovesThe')}
              >
                <RawList
                  rows={withdrawals.data ?? []}
                  empty={t('sellerWalletsIdSellerWalletDetail.noWithdrawalRequests')}
                />
              </MkCard>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * Top-up and withdrawal rows differ in shape, and both already have a
 * rendered view on their own admin pages. Rather than clone those two
 * tables here — where they would drift the moment either changes — this
 * shows the fields both actually carry, and links to the page that owns
 * the actions.
 */
function RawList({
  rows,
  empty,
}: {
  readonly rows: readonly unknown[];
  readonly empty: string;
}): ReactElement {
  const t = useT();
  if (rows.length === 0) {
    return (
      <div className="mk-card__head">
        <p className="mk-muted">{empty}</p>
      </div>
    );
  }
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{t('sellerWalletsIdSellerWalletDetail.when')}</Th>
          <Th align="right">{t('sellerWalletsIdSellerWalletDetail.amount')}</Th>
          <Th>{t('sellerWalletsIdSellerWalletDetail.status')}</Th>
          <Th>{t('sellerWalletsIdSellerWalletDetail.note')}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((raw, i) => {
          const r = raw as {
            id?: string;
            createdAt?: string;
            amount?: string;
            amountRequested?: string;
            currency?: string;
            status?: string;
            reviewNote?: string | null;
            note?: string | null;
          };
          return (
            <Tr key={r.id ?? String(i)}>
              <Td className="mk-when sk-figure">
                {r.createdAt === undefined ? '—' : new Date(r.createdAt).toLocaleString()}
              </Td>
              <Td align="right">
                <Money
                  amount={r.amount ?? r.amountRequested ?? '0'}
                  currency={r.currency === 'BDT' ? 'BDT' : 'INR'}
                  convert={false}
                />
              </Td>
              <Td className="mk-small mk-body">{r.status ?? '—'}</Td>
              <Td className="mk-faint">{r.reviewNote ?? r.note ?? '—'}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
