'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Stat,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import {
  useSellerWalletDetail,
  useSellerWalletEntries,
  useSellerWalletTopups,
  useSellerWalletWithdrawals,
  type AdminWalletEntry,
} from '@/lib/seller-wallet-hooks';
import { isWalletCredit, walletDirectionLabel } from '@skydrop/ui/status';
import type { WalletEntryDirection } from '@skydrop/db';
import { useSellerHoldings } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';

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
  const detail = useSellerWalletDetail(sellerId);
  const entries = useSellerWalletEntries(sellerId);
  const topups = useSellerWalletTopups(sellerId);
  const withdrawals = useSellerWalletWithdrawals(sellerId);
  const holdings = useSellerHoldings(canReadTreasury ? sellerId : null);
  const [tab, setTab] = useState<'ledger' | 'topups' | 'withdrawals'>('ledger');

  if (detail.isLoading) return <LoadingState />;
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
    <div className="space-y-4">
      <PageHeader
        title={d.seller.companyName}
        subtitle={`${d.seller.email} · ${d.seller.status}`}
        action={
          <Link href="/seller-wallets" className="text-accent text-sm hover:underline">
            ← All wallets
          </Link>
        }
      />

      {/* The figures that make each other up, rather than one number the
          reader has to trust. Balance is what the ledger says; available
          is what could actually leave today. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Balance"
          value={<Money amount={d.balanceInr} currency="INR" />}
          hint={Number(d.balanceInr) < 0 ? 'They owe us' : 'We owe them'}
          tone={Number(d.balanceInr) < 0 ? 'bad' : 'neutral'}
        />
        <Stat
          label="Available to withdraw"
          value={<Money amount={d.withdrawableInr} currency="INR" />}
          hint="Balance, less the floor and anything already requested"
        />
        <Stat
          label="Requested, not yet paid"
          value={<Money amount={d.pendingWithdrawalInr} currency="INR" />}
          hint="Still in the balance — held, because a request is not a payment"
          tone="warn"
        />
        <Stat
          label="Top-ups awaiting review"
          value={<Money amount={d.pendingTopupInr} currency="INR" />}
          hint="Claimed, not matched to a statement — in no balance yet"
        />
      </div>

      {/* Where the money physically is, which the balance above does not
          say. The wallet is what we OWE them; this is which of our
          accounts the cash is sitting in — the question a payout has to
          answer before it can be made, because paying BDT out of an
          account holding only INR is not something a balance can warn
          you about. */}
      <Card>
        <CardHeader title="Where their money is held" />
        <CardBody>
          {holdings.isLoading ? (
            <p className="text-text-muted text-sm">Reading the bank book…</p>
          ) : holdings.isError || holdings.data === undefined ? (
            <p className="text-text-muted text-sm">
              Could not read the bank book. The balance above is unaffected.
            </p>
          ) : holdings.data.length === 0 ? (
            <p className="text-text-muted text-sm">
              No cash is recorded against this seller in any account. If they hold a balance, it was
              credited before the bank book existed, or by a flow that has not been wired to it.
            </p>
          ) : (
            <dl className="space-y-1.5">
              {holdings.data.map((h) => (
                <div key={`${h.accountId}-${h.currency}`} className="flex justify-between gap-4">
                  <dt className="text-text-muted text-sm">
                    {h.accountLabel} · {h.currency}
                  </dt>
                  <dd className="text-sm">
                    <Money amount={h.amount} currency={h.currency} convert={false} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>

      {Number(d.minimumBalanceInr) > 0 && (
        <p className="text-text-muted text-xs">
          This account must leave <Money amount={d.minimumBalanceInr} currency="INR" /> in the
          wallet — it is the only security we hold against an unpaid delivery fee.
        </p>
      )}

      {/* The rules actually in force for this seller — resolved, so the
          number shown is the one being applied rather than the two
          places it might have come from (SET-1). Read-only: they are
          edited where they are owned. */}
      <Card>
        <CardHeader
          title="Wallet rules for this seller"
          subtitle="What is in force right now. A value marked OVERRIDE was set for them; the rest are the system default."
          action={
            <Link href="/settings" className="text-accent text-sm hover:underline">
              Edit defaults →
            </Link>
          }
        />
        <CardBody>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {d.settings.map((st) => (
              <div key={st.key} className="flex items-baseline justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-text-body">{st.label}</div>
                  {st.hint !== '' && <div className="text-text-faint text-xs">{st.hint}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-text-bright font-mono">{st.value}</span>
                  {st.source === 'SELLER_OVERRIDE' && (
                    <span className="text-pending ml-2 text-[11px] uppercase">override</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="border-border flex flex-wrap gap-1 border-b">
        {(
          [
            ['ledger', 'Ledger'],
            ['topups', 'Top-ups'],
            ['withdrawals', 'Withdrawal requests'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'true' : undefined}
            className={
              'inline-flex min-h-[36px] items-center rounded-t-[4px] px-3 text-sm transition-colors ' +
              (tab === key
                ? 'border-accent text-text-bright border-b-2 font-medium'
                : 'text-text-muted hover:text-text-body border-b-2 border-transparent')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ledger' && (
        <Card>
          <CardHeader
            title="Ledger"
            subtitle="Every entry, newest first. Only money that actually moved appears here."
          />
          <CardBody>
            <Table>
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
                      <Td className="text-text-muted text-xs">
                        {new Date(e.createdAt).toLocaleString()}
                      </Td>
                      <Td className="text-text-body text-xs">
                        {/* The raw enum was on screen: ORDER_CHARGES,
                            INSTANT_PAY_FEE. Staff answering "why is my
                            balance this" were reading the column name
                            out of the database. */}
                        {walletDirectionLabel(e.direction as WalletEntryDirection)}
                        {e.note !== null && <div className="text-text-faint italic">{e.note}</div>}
                      </Td>
                      {/* Staff reading a disputed balance had no route
                          from an entry to what it charged for: the id was
                          in the payload and nothing rendered it. */}
                      <Td className="text-xs">
                        {e.linkedOrderId !== null ? (
                          <Link
                            href={`/orders/${e.linkedOrderId}`}
                            className="text-accent hover:underline font-mono"
                          >
                            {e.linkedOrderNumber ?? 'Order'} →
                          </Link>
                        ) : e.linkedConsignmentId !== null ? (
                          <Link
                            href={`/warehouse/consignments/${e.linkedConsignmentId}`}
                            className="text-accent hover:underline font-mono"
                          >
                            {e.linkedConsignmentNumber ?? 'Consignment'} →
                          </Link>
                        ) : (
                          <span className="text-text-faint">—</span>
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
                            isWalletCredit(e.direction as WalletEntryDirection) ? 'credit' : 'debit'
                          }
                        />
                      </Td>
                      <Td align="right" className="text-text-muted">
                        <Money amount={e.runningBalanceAfter} currency="INR" />
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {tab === 'topups' && (
        <Card>
          <CardHeader
            title="Top-ups"
            subtitle="Every claim, whatever became of it. Only accepted ones reach the ledger."
          />
          <CardBody>
            <RawList rows={topups.data ?? []} empty="No top-ups claimed." />
          </CardBody>
        </Card>
      )}

      {tab === 'withdrawals' && (
        <Card>
          <CardHeader
            title="Withdrawal requests"
            subtitle="A request never moves the balance — the remittance does."
          />
          <CardBody>
            <RawList rows={withdrawals.data ?? []} empty="No withdrawal requests." />
          </CardBody>
        </Card>
      )}
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
  if (rows.length === 0) return <p className="text-text-muted py-2 text-sm">{empty}</p>;
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
              <Td className="text-text-muted text-xs">
                {r.createdAt === undefined ? '—' : new Date(r.createdAt).toLocaleString()}
              </Td>
              <Td align="right">
                <Money
                  amount={r.amount ?? r.amountRequested ?? '0'}
                  currency={r.currency === 'BDT' ? 'BDT' : 'INR'}
                  convert={false}
                />
              </Td>
              <Td className="text-text-body text-xs">{r.status ?? '—'}</Td>
              <Td className="text-text-faint text-xs">{r.reviewNote ?? r.note ?? '—'}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
