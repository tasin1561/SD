'use client';

import { useState, type ReactElement } from 'react';
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

/**
 * One seller's wallet, from our side — the same three views they have,
 * without the two buttons that move money.
 *
 * Read-only deliberately. An operator looking at a balance and an
 * operator changing one are different jobs, and a page that does both is
 * one where a mis-click looks like a report.
 */
export function SellerWalletDetailView({ sellerId }: { readonly sellerId: string }): ReactElement {
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
        <SkeletonRows rows={6} cols={5} label="Loading wallet…" />
      </div>
    );
  }
  if (detail.isError || detail.data === undefined) {
    return (
      <ErrorState
        message={detail.error?.message ?? 'Failed to load.'}
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
            <ArrowLeft size={14} aria-hidden /> All wallets
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
          label="Balance"
          figure={<Money amount={d.balanceInr} currency="INR" />}
          hint={Number(d.balanceInr) < 0 ? 'They owe us' : 'We owe them'}
          tone={Number(d.balanceInr) < 0 ? 'debit' : 'neutral'}
        />
        <KpiCard
          label="Available to withdraw"
          figure={<Money amount={d.withdrawableInr} currency="INR" />}
          hint="Balance, less the floor and anything already requested"
        />
        <KpiCard
          label="Requested, not yet paid"
          figure={<Money amount={d.pendingWithdrawalInr} currency="INR" />}
          hint="Still in the balance — held, because a request is not a payment"
          tone="pending"
        />
        <KpiCard
          label="Top-ups awaiting review"
          figure={<Money amount={d.pendingTopupInr} currency="INR" />}
          hint="Claimed, not matched to a statement — in no balance yet"
        />
      </div>

      {/* Money we paid this seller before the courier paid us (Instant
          Pay). It is inside their balance above; what this adds is that
          the courier still owes it to US. */}
      {canReadTreasury &&
        (advances.isError ? (
          <p className="mk-muted">
            Could not read Instant Pay advances.{' '}
            <button
              type="button"
              className="mk-inline-link"
              onClick={() => void advances.refetch()}
            >
              Retry
            </button>
          </p>
        ) : advances.data !== undefined ? (
          <p className="mk-muted">
            <span>Advanced via Instant Pay, awaiting courier: </span>
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
                  See orders →
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
      <MkCard title="Where their money is held" icon={<Landmark size={18} />}>
        {holdings.isLoading ? (
          <p className="mk-muted">Reading the bank book…</p>
        ) : holdings.isError || holdings.data === undefined ? (
          <p className="mk-muted">Could not read the bank book. The balance above is unaffected.</p>
        ) : holdings.data.length === 0 ? (
          <p className="mk-muted">
            No cash is recorded against this seller in any account. If they hold a balance, it was
            credited before the bank book existed, or by a flow that has not been wired to it.
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
                      Correct
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
          This account must leave <Money amount={d.minimumBalanceInr} currency="INR" /> in the
          wallet — it is the only security we hold against an unpaid delivery fee.
        </p>
      )}

      {/* The rules actually in force for this seller — resolved, so the
          number shown is the one being applied rather than the two
          places it might have come from (SET-1). Read-only: they are
          edited where they are owned. */}
      <MkCard
        title="Wallet rules for this seller"
        subtitle="What is in force right now. A value marked override was set for them; the rest are the system default."
        icon={<Scale size={18} />}
        aside={
          <Link href="/settings" className="mk-link">
            Edit defaults <ArrowRight size={14} aria-hidden />
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
        label="Wallet history"
        value={tab}
        onChange={(id) => setTab(id as 'ledger' | 'topups' | 'withdrawals')}
        items={[
          {
            id: 'ledger',
            label: 'Ledger',
            panel: (
              <MkCard
                flush
                title="Ledger"
                subtitle="Every entry, newest first. Only money that actually moved appears here."
              >
                <Table caption="Ledger">
                  <THead>
                    <Tr>
                      <Th>When</Th>
                      <Th>Type</Th>
                      <Th>Linked</Th>
                      <Th align="right">Amount</Th>
                      <Th align="right">Balance after</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {(entries.data?.items ?? []).length === 0 ? (
                      <TableEmpty colSpan={5}>No entries yet.</TableEmpty>
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
                                {e.linkedOrderNumber ?? 'Order'} →
                              </Link>
                            ) : e.linkedConsignmentId !== null ? (
                              <Link
                                href={`/warehouse/consignments/${e.linkedConsignmentId}`}
                                className="mk-inline-link sk-ident mk-small"
                              >
                                {e.linkedConsignmentNumber ?? 'Consignment'} →
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
            label: 'Top-ups',
            panel: (
              <MkCard
                flush
                title="Top-ups"
                subtitle="Every claim, whatever became of it. Only accepted ones reach the ledger."
              >
                <RawList rows={topups.data ?? []} empty="No top-ups claimed." />
              </MkCard>
            ),
          },
          {
            id: 'withdrawals',
            label: 'Withdrawal requests',
            panel: (
              <MkCard
                flush
                title="Withdrawal requests"
                subtitle="A request never moves the balance — the remittance does."
              >
                <RawList rows={withdrawals.data ?? []} empty="No withdrawal requests." />
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
          <Th>When</Th>
          <Th align="right">Amount</Th>
          <Th>Status</Th>
          <Th>Note</Th>
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
