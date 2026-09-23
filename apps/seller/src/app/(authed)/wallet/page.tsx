'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Coins,
  Download,
  HandCoins,
  Landmark,
  Plus,
} from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { isWalletCredit } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Tabs } from '@skydrop/ui/app/tabs';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { LedgerEntryLabel } from './_components/ledger-entry-label';
import { useInfiniteWalletEntries, useWalletBalances } from '@/lib/api-hooks';
import { TopupCard } from './_components/topup-card';
import { WithdrawalsCard } from './_components/withdrawals-card';
import type { WalletEntryView } from '@skydrop/api-client';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { CreditStandingCard } from './_components/credit-standing-card';
import { WalFact, WalStripFact } from './_components/wallet-parts';

type WalletTab = 'ledger' | 'withdrawals' | 'topups';

function isWalletTab(id: string): id is WalletTab {
  return id === 'ledger' || id === 'withdrawals' || id === 'topups';
}

/**
 * Phase 1B M24 — seller wallet. Top: the balance as stat tiles (INR +
 * the BDT view of the same money). Below: the paginated ledger. Each
 * entry's linked order is a click-through to the order detail.
 *
 * No mutation surface here beyond the two requests — a top-up is a
 * CLAIM and a withdrawal is a REQUEST; only an operator moves money
 * (WAL-2 / WAL-3).
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT WE DO NOT HAVE ─────────────────
 * Every tile on a wallet screen is read as a statement about somebody's
 * money, so these are absent rather than approximated:
 *
 *   MONEY IN / OUT THIS MONTH   the ledger is fetched a page at a time
 *       and totals would be of the LOADED WINDOW, not of the month — a
 *       figure that grows as you scroll is worse than no figure. There
 *       is no period-summary endpoint.
 *   AVAILABLE TO WITHDRAW       real (`…/withdrawal-requests/eligibility`)
 *       but it needs `wallet.withdraw`, which this page does not, so
 *       firing it here would 403 on load for everyone else. It is on
 *       the withdrawal form, where the permission is already held.
 *   NEXT PAYOUT DATE            withdrawals are requested and paid by
 *       hand; nothing schedules one, so there is no date to show. The
 *       schedule rules live on /wallet/limits.
 */
export default function WalletPage(): ReactElement {
  const [exporting, setExporting] = useState(false);
  /**
   * Three views of the same money, switched in place rather than split
   * across pages: the ledger is what HAPPENED, the other two are what
   * was ASKED FOR and has not landed yet. A seller checking "did my
   * transfer go through" should not have to know which page that lives
   * on.
   */
  const [tab, setTab] = useState<WalletTab>('ledger');
  // The modals are driven from the balance row, so their open state
  // lives here rather than inside the list that shows their history.
  const [topupOpen, setTopupOpen] = useState(false);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const identity = useSellerIdentity();
  const mayTopup = can(identity, 'wallet.topup');
  const mayWithdraw = can(identity, 'wallet.withdraw');
  const balances = useWalletBalances();
  const entries = useInfiniteWalletEntries();
  const accumulated = entries.data?.pages.flatMap((p) => p.items) ?? [];

  const rows = balances.data?.balances ?? [];
  // The canonical figure. Everything the system stores is rupees; a BDT
  // row is the SAME money converted for reading, which is why it is a
  // second tile rather than a second balance.
  const inr = rows.find((b) => b.currency === 'INR') ?? rows.find((b) => !b.isConverted);
  const owed = inr === undefined ? null : Number(inr.balance);

  async function exportAll(): Promise<void> {
    // Fetch any remaining pages BEFORE rendering the CSV so the
    // download contains the entire ledger, not just the visible
    // window. Safe: useInfiniteWalletEntries' getNextPageParam
    // returns null when the server runs out.
    setExporting(true);
    try {
      while (entries.hasNextPage && !entries.isFetchingNextPage) {
        await entries.fetchNextPage();
      }
      const full = entries.data?.pages.flatMap((p) => p.items) ?? [];
      downloadCsv(full);
    } finally {
      setExporting(false);
    }
  }

  const ledgerPanel = entries.isLoading ? (
    <SkeletonRows rows={6} cols={5} label="Loading your ledger…" />
  ) : entries.isError ? (
    <ErrorState
      message={entries.error?.message ?? 'Failed.'}
      retry={() => void entries.refetch()}
    />
  ) : accumulated.length === 0 ? (
    <EmptyState
      title="No ledger entries yet."
      description="Once an order delivers (COD), your wallet will accrue (COD amount − shipping + GST)."
    />
  ) : (
    <>
      {/* The `Table` primitive, not a hand-rolled `<thead>`: a raw table
          here kept its desktop shape on a phone and scrolled the page
          sideways, while every other list in the app folded into cards
          (FE-7). */}
      <Table caption="Wallet ledger">
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
          {accumulated.map((e) => (
            <LedgerRow key={e.id} entry={e} />
          ))}
        </TBody>
      </Table>
      {entries.hasNextPage && (
        <div className="wal-more">
          <AsyncButton
            variant="secondary"
            size="md"
            disabled={entries.isFetchingNextPage}
            labels={{ idle: 'Load more', busy: 'Loading…', done: 'Loaded' }}
            settleMs={600}
            onAction={() => entries.fetchNextPage()}
          />
        </div>
      )}
    </>
  );

  const topupsPanel = mayTopup ? (
    <TopupCard open={topupOpen} onOpenChange={setTopupOpen} />
  ) : (
    <p className="wal-muted">Top-ups are recorded by an owner or finance account.</p>
  );

  const withdrawalsPanel = mayWithdraw ? (
    <WithdrawalsCard requesting={withdrawalOpen} onRequestingChange={setWithdrawalOpen} />
  ) : (
    <p className="wal-muted">Withdrawal requests are handled by an owner or finance account.</p>
  );

  return (
    <div className="wal-page">
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Money' }, { label: 'Wallet' }]}
        Link={Link}
        title="Wallet"
        subtitle="What's owed to you. COD net of charges per delivered order; remittances debit as we pay you out."
        meta={
          owed === null ? undefined : (
            <span className="wal-meta">
              <WalFact tone={owed > 0 ? 'good' : owed < 0 ? 'bad' : undefined} dot>
                {owed > 0 ? 'Owed to you' : owed < 0 ? 'You owe' : 'Settled'}
              </WalFact>
              {rows.some((b) => b.isConverted) && <WalFact>Also shown in taka</WalFact>}
            </span>
          )
        }
        action={
          mayTopup || mayWithdraw ? (
            <div className="wal-actions">
              {mayTopup && (
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus size={15} />}
                  onClick={() => {
                    // Switch to the tab as well as opening the modal, so the
                    // seller lands where the request they are about to make
                    // will appear.
                    setTab('topups');
                    setTopupOpen(true);
                  }}
                >
                  Top-up wallet
                </Button>
              )}
              {mayWithdraw && (
                <Button
                  variant="secondary"
                  size="md"
                  icon={<HandCoins size={15} />}
                  onClick={() => {
                    setTab('withdrawals');
                    setWithdrawalOpen(true);
                  }}
                >
                  Request a withdrawal
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Above everything, and only when it applies. A seller who is
          about to be refused should learn it here rather than at the
          moment they try to place an order. */}
      <CreditStandingCard />

      {/* ── The balance ─────────────────────────────────────────────
             KPI cards: same figures, same `convert={false}` (each names
             its own currency, and letting the display conversion run
             turned the INR card into the taka one beside it). Each figure
             is the SAME `<Money>` node, handed to the card as `figure`, so
             nothing re-formats it. A third card is deliberately absent —
             see the header comment. */}
      <div className="wal-kpis">
        {balances.isLoading ? (
          <>
            <Skeleton className="wal-kpi-skel" height={104} rounded="md" />
            <Skeleton className="wal-kpi-skel" height={104} rounded="md" />
          </>
        ) : balances.isError ? (
          <ErrorState
            message={balances.error?.message ?? 'Failed.'}
            retry={() => void balances.refetch()}
          />
        ) : (
          rows.map((b) => (
            <KpiCard
              key={b.currency}
              label={b.isConverted ? `Your balance in ${b.currency}` : `Balance · ${b.currency}`}
              icon={b.isConverted ? <Coins size={14} /> : <Landmark size={14} />}
              figure={
                <Money
                  amount={b.balance}
                  currency={b.currency === 'BDT' ? 'BDT' : 'INR'}
                  convert={false}
                  size="lg"
                />
              }
              tone={
                b.isConverted
                  ? 'neutral'
                  : Number(b.balance) > 0
                    ? 'credit'
                    : Number(b.balance) < 0
                      ? 'debit'
                      : 'neutral'
              }
              hint={
                // A converted figure is the SAME money counted in
                // another currency, not a second balance — saying
                // "owed to you" on both would read as twice as much
                // money.
                b.isConverted
                  ? `Your rupee balance in taka${b.fxRate === null ? '' : ` · ₹1 = ৳${Number(b.fxRate).toFixed(2)}`}`
                  : Number(b.balance) === 0
                    ? 'No activity yet.'
                    : Number(b.balance) > 0
                      ? 'Owed to you, and goes out with your next withdrawal.'
                      : 'You owe this much; it clears as your stock sells.'
              }
            />
          ))
        )}
      </div>

      {/* One switcher, three views of the same money. Building these as
          separate pages would make "did my transfer go through?" a
          navigation problem. */}
      <section className="wal-section">
        <SectionHeading
          title={tab === 'ledger' ? 'Ledger' : tab === 'topups' ? 'Top-ups' : 'Withdrawal requests'}
          note={
            tab === 'ledger'
              ? 'Every movement, oldest last.'
              : tab === 'topups'
                ? 'Money you have told us you sent.'
                : 'Money you have asked us to pay out.'
          }
          action={
            <span className="wal-actions">
              <Link href="/wallet/limits" className="wal-link">
                Limits and settings
                <ArrowRight size={13} aria-hidden />
              </Link>
              {tab === 'ledger' && (
                <AsyncButton
                  variant="ghost"
                  size="sm"
                  icon={<Download size={14} />}
                  disabled={accumulated.length === 0 || exporting}
                  labels={{ idle: 'Export CSV', busy: 'Loading all…', done: 'Downloaded' }}
                  onAction={exportAll}
                />
              )}
            </span>
          }
        />

        <Tabs
          label="Wallet views"
          size="sm"
          panelClassName="wal-panel"
          value={tab}
          onChange={(id) => {
            if (isWalletTab(id)) setTab(id);
          }}
          items={[
            { id: 'ledger', label: 'Ledger', panel: ledgerPanel },
            // Money in before money out: a seller whose balance is
            // short needs the top-up, not the withdrawal form.
            { id: 'topups', label: 'Top-ups', panel: topupsPanel },
            { id: 'withdrawals', label: 'Withdrawal requests', panel: withdrawalsPanel },
          ]}
        />
      </section>

      <div className="wal-strip">
        {owed !== null && (
          <WalStripFact
            label="Balance"
            value={<Money amount={inr?.balance ?? '0'} convert={false} />}
            tone={owed < 0 ? 'warn' : 'good'}
          />
        )}
        <WalStripFact
          label="Entries loaded"
          value={entries.isLoading ? '—' : `${accumulated.length}${entries.hasNextPage ? '+' : ''}`}
        />
        <span className="wal-strip__note">
          Remittances are paid to the bank account on your profile —{' '}
          <Link href="/profile">update it</Link> before your first withdrawal.
        </span>
      </div>
    </div>
  );
}

/**
 * Which way a direction points now lives in `@skydrop/ui/status`, as an
 * EXHAUSTIVE SWITCH rather than the hand-maintained Set that used to sit
 * here.
 *
 * WAL-1 required this set to mirror the API's `CREDIT_DIRECTIONS` and
 * noted that TypeScript could not check it — so an unregistered
 * direction silently took money from the seller instead of giving it,
 * and only a spec that read both files as TEXT caught the drift. The
 * switch fails to BUILD instead, and admin reads the same one, so there
 * is no second copy to keep in step.
 *
 * The direction is shown three ways — the arrow chip, the sign and the
 * colour of the figure — so colour is never the only signal.
 */
function LedgerRow({ entry }: { readonly entry: WalletEntryView }): ReactElement {
  const isCredit = isWalletCredit(entry.direction);
  const currency = entry.currency === 'BDT' ? 'BDT' : 'INR';
  return (
    <Tr>
      <Td className="wal-when sk-figure">{new Date(entry.createdAt).toLocaleString()}</Td>
      <Td>
        <div className="wal-type">
          <span className="wal-dir" data-dir={isCredit ? 'credit' : 'debit'} aria-hidden>
            {isCredit ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
          </span>
          <div className="wal-type__text">
            <LedgerEntryLabel direction={entry.direction} note={entry.note} />
          </div>
        </div>
      </Td>
      <Td>
        {entry.linkedOrderId ? (
          <Link href={`/orders/${entry.linkedOrderId}`} className="wal-linked sk-ident">
            {entry.linkedOrderNumber ?? 'Order'} →
          </Link>
        ) : entry.linkedConsignmentId ? (
          <Link href={`/inbound/${entry.linkedConsignmentId}`} className="wal-linked sk-ident">
            {entry.linkedConsignmentNumber ?? 'Consignment'} →
          </Link>
        ) : entry.linkedRemittanceId ? (
          <span className="wal-faint">Remittance</span>
        ) : (
          <span className="wal-faint">—</span>
        )}
      </Td>
      <Td align="right">
        <Money
          amount={entry.amount}
          currency={currency}
          direction={isCredit ? 'credit' : 'debit'}
        />
      </Td>
      <Td align="right">
        <Money amount={entry.runningBalanceAfter} currency={currency} />
      </Td>
    </Tr>
  );
}

/**
 * CSV export of the visible ledger page.
 * Header row first; one row per entry. Values are RFC-4180 quoted
 * (embedded `"` → `""`) so the file opens cleanly in Excel/Sheets.
 */
function downloadCsv(items: ReadonlyArray<WalletEntryView>): void {
  if (items.length === 0) return;
  const header = [
    'created_at',
    'currency',
    'direction',
    'amount',
    'running_balance_after',
    'linked_order_id',
    'linked_order_number',
    'linked_remittance_id',
    'reason_code',
    'note',
  ];
  const quote = (v: string | null): string => {
    if (v === null) return '';
    return `"${v.replace(/"/g, '""')}"`;
  };
  const rows = items.map((e) =>
    [
      e.createdAt,
      e.currency,
      e.direction,
      e.amount,
      e.runningBalanceAfter,
      e.linkedOrderId ?? '',
      e.linkedOrderNumber ?? '',
      e.linkedRemittanceId ?? '',
      e.reasonCode ?? '',
      e.note ?? '',
    ]
      .map(quote)
      .join(','),
  );
  const csv = [header.map(quote).join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `skydrop-wallet-ledger-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
