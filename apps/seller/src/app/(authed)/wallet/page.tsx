'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Download } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Money,
  PageHeader,
  Skeleton,
  SkeletonRows,
  Table,
} from '@skydrop/ui/components';
import { useInfiniteWalletEntries, useWalletBalances } from '@/lib/api-hooks';
import { TopupCard } from './_components/topup-card';
import { WalletTermsCard } from './_components/wallet-terms-card';
import { WithdrawalsCard } from './_components/withdrawals-card';
import type { WalletEntryView } from '@skydrop/api-client';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';

/**
 * Phase 1B M24 — seller wallet. Top: balance cards (INR + BDT).
 * Below: the paginated ledger. Each entry's
 * linkedOrder column is a click-through to the order detail.
 *
 * No mutation surface here — sellers can't initiate remits (admin
 * does it). They just see the books.
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
  const [tab, setTab] = useState<'ledger' | 'payouts' | 'topups'>('ledger');
  // The modals are driven from the balance row, so their open state
  // lives here rather than inside the list that shows their history.
  const [topupOpen, setTopupOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const identity = useSellerIdentity();
  const mayTopup = can(identity, 'wallet.topup');
  const mayWithdraw = can(identity, 'wallet.withdraw');
  const balances = useWalletBalances();
  const entries = useInfiniteWalletEntries();
  const accumulated = entries.data?.pages.flatMap((p) => p.items) ?? [];

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Wallet"
        subtitle="What's owed to you. COD net of charges per delivered order; remittances debit as we pay you out."
      />

      {/* The two ways money moves, beside the number they move. They
          used to sit at the bottom of the page, each heading its own
          card of history — so the button a seller came for was below the
          record of what they had already done. */}
      {(mayTopup || mayWithdraw) && (
        <div className="flex flex-wrap gap-2">
          {mayTopup && (
            <Button
              variant="primary"
              size="md"
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
              onClick={() => {
                setTab('payouts');
                setPayoutOpen(true);
              }}
            >
              Request a payout
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {balances.isLoading ? (
          <>
            <Skeleton className="h-[104px]" />
            <Skeleton className="h-[104px]" />
          </>
        ) : balances.isError ? (
          <ErrorState
            message={balances.error?.message ?? 'Failed.'}
            retry={() => void balances.refetch()}
          />
        ) : (
          (balances.data?.balances ?? []).map((b) => (
            <Card key={b.currency}>
              <CardBody>
                <div className="text-text-faint text-xs uppercase tracking-wide mb-1">
                  {b.currency}
                </div>
                <div className="text-text-bright">
                  <Money
                    amount={b.balance}
                    currency={b.currency === 'BDT' ? 'BDT' : 'INR'}
                    size="lg"
                  />
                </div>
                <div className="text-text-muted text-xs mt-1">
                  {/* A converted figure is the SAME money counted in
                      another currency, not a second balance — saying
                      "owed to you" on both would read as twice as much
                      money. */}
                  {b.isConverted
                    ? `Your rupee balance in taka${b.fxRate === null ? '' : ` · ₹1 = ৳${Number(b.fxRate).toFixed(2)}`}`
                    : Number(b.balance) === 0
                      ? 'No activity yet'
                      : Number(b.balance) > 0
                        ? 'Owed to you'
                        : 'You owe'}
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      {/* One switcher, three views of the same money. Building these as
          separate pages would make "did my transfer go through?" a
          navigation problem. */}
      <div className="border-border flex flex-wrap gap-1 border-b">
        {(
          [
            ['ledger', 'Ledger'],
            // Money in before money out: a seller whose balance is short
            // needs the top-up, not the payout form.
            ['topups', 'Top-ups'],
            ['payouts', 'Payout requests'],
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
            action={
              <div className="flex items-center gap-2">
                {/* The all/INR/BDT segmented filter is gone. Every entry the
                  system writes is INR — BDT is a conversion of the
                  balance, not a pot with its own entries — so 'BDT'
                  selected an always-empty ledger while 'all' and 'INR'
                  were the same list. A control with one real setting is
                  not a control. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={accumulated.length === 0 || exporting}
                  onClick={() => void exportAll()}
                >
                  <Download size={12} /> {exporting ? 'Loading all…' : 'Export CSV'}
                </Button>
              </div>
            }
          />
          <CardBody>
            {entries.isLoading ? (
              <SkeletonRows rows={6} cols={5} />
            ) : entries.isError ? (
              <ErrorState
                message={entries.error?.message ?? 'Failed.'}
                retry={() => void entries.refetch()}
              />
            ) : accumulated.length === 0 ? (
              <div className="text-text-muted text-sm py-4">
                No ledger entries yet. Once an order delivers (COD), your wallet will accrue (COD
                amount − shipping + GST).
              </div>
            ) : (
              <Table wrapperClassName="rounded-none border-0 bg-transparent">
                <thead className="text-text-muted text-xs uppercase tracking-wide bg-surface-raised border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">When</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">Linked</th>
                    <th className="text-right px-3 py-2 font-medium">Amount</th>
                    <th className="text-right px-3 py-2 font-medium">Balance after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {accumulated.map((e) => (
                    <LedgerRow key={e.id} entry={e} />
                  ))}
                </tbody>
              </Table>
            )}
            {entries.hasNextPage && (
              <div className="flex justify-center mt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  disabled={entries.isFetchingNextPage}
                  onClick={() => void entries.fetchNextPage()}
                >
                  {entries.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'topups' &&
        (mayTopup ? (
          <TopupCard open={topupOpen} onOpenChange={setTopupOpen} />
        ) : (
          <p className="text-text-muted text-sm">
            Top-ups are recorded by an owner or finance account.
          </p>
        ))}
      {tab === 'payouts' &&
        (mayWithdraw ? (
          <WithdrawalsCard requesting={payoutOpen} onRequestingChange={setPayoutOpen} />
        ) : (
          <p className="text-text-muted text-sm">
            Payout requests are handled by an owner or finance account.
          </p>
        ))}

      <WalletTermsCard />

      <div className="text-text-faint text-xs">
        Remittances are paid to the bank account on your profile. Update your bank details on{' '}
        <Link href="/profile" className="text-accent hover:underline">
          /profile
        </Link>{' '}
        before requesting your first payout.
      </div>
    </div>
  );
}

/**
 * Directions that ADD to the wallet. MUST mirror the API's
 * `CREDIT_DIRECTIONS` (seller-wallet/services/wallet.service.ts) — this
 * only drives the sign + colour, so drift here would render a credit as
 * a red "−250.50" (or vice versa) while the ledger says the opposite.
 * Unlike `humanizeDirection` below, TypeScript cannot catch an omission
 * here, so it has to be updated deliberately alongside the API set.
 */
const CREDIT_DIRECTIONS: ReadonlySet<WalletEntryView['direction']> = new Set([
  'COD_COLLECTION',
  'REMITTANCE_FX',
  'ADJUSTMENT_CREDIT',
  'OPENING_BALANCE',
  'SCRAP_REFUND',
  'TOPUP',
  'ORDER_CHARGES_REFUND',
]);

function LedgerRow({ entry }: { readonly entry: WalletEntryView }): ReactElement {
  const isCredit = CREDIT_DIRECTIONS.has(entry.direction);
  const currency = entry.currency === 'BDT' ? 'BDT' : 'INR';
  return (
    <tr>
      <td className="px-3 py-2 text-text-muted font-mono text-xs">
        {new Date(entry.createdAt).toLocaleString()}
      </td>
      <td className="px-3 py-2 text-text-body text-xs">
        {humanizeDirection(entry.direction)}
        {entry.note && <div className="text-text-faint text-xs mt-0.5 italic">{entry.note}</div>}
      </td>
      <td className="px-3 py-2 text-text-body text-xs">
        {entry.linkedOrderId ? (
          <Link
            href={`/orders/${entry.linkedOrderId}`}
            className="text-accent hover:underline font-mono text-xs"
          >
            Order →
          </Link>
        ) : entry.linkedConsignmentId ? (
          <Link
            href={`/inbound/${entry.linkedConsignmentId}`}
            className="text-accent hover:underline font-mono text-xs"
          >
            {entry.linkedConsignmentNumber ?? 'Consignment'} →
          </Link>
        ) : entry.linkedRemittanceId ? (
          <span className="text-text-muted text-xs">Remittance</span>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Money
          amount={entry.amount}
          currency={currency}
          direction={isCredit ? 'credit' : 'debit'}
        />
      </td>
      <td className="px-3 py-2 text-right text-text-body">
        <Money amount={entry.runningBalanceAfter} currency={currency} />
      </td>
    </tr>
  );
}

function humanizeDirection(d: WalletEntryView['direction']): string {
  switch (d) {
    case 'COD_COLLECTION':
      return 'COD collected';
    case 'ORDER_CHARGES':
      return 'Order charges';
    case 'REMITTANCE_OUT':
      return 'Remittance';
    case 'REMITTANCE_FX':
      return 'FX conversion';
    case 'ADJUSTMENT_CREDIT':
      return 'Adjustment (credit)';
    case 'ADJUSTMENT_DEBIT':
      return 'Adjustment (debit)';
    case 'OPENING_BALANCE':
      return 'Opening balance';
    // R7 — a damage/loss ticket settled in the seller's favour.
    case 'SCRAP_REFUND':
      return 'Damage settlement';
    // R3 — the BD→India inbound freight bill for a consignment. A DEBIT,
    // so it stays OUT of CREDIT_DIRECTIONS above (that set is mirrored
    // from the API's WalletService — adding it here would render a charge
    // as a payment).
    case 'INBOUND_FREIGHT':
      return 'Inbound freight';
    // The flat return fee, charged when a parcel physically comes back.
    // A DEBIT, so it stays OUT of CREDIT_DIRECTIONS above for the same
    // reason as inbound freight.
    case 'RTO_FEE':
      return 'Return fee';
    // Money the seller wired in, verified against the bank. A CREDIT —
    // registered in CREDIT_DIRECTIONS above.
    case 'TOPUP':
      return 'Wallet top-up';
    // What Instant Pay costs: being credited at delivery rather than
    // waiting for the courier to settle. A DEBIT, so it stays OUT of
    // CREDIT_DIRECTIONS above.
    case 'INSTANT_PAY_FEE':
      return 'Instant Pay fee';
    // The base charge for handling COD, on both credit modes. A DEBIT,
    // so it stays OUT of CREDIT_DIRECTIONS above.
    case 'COD_COLLECTION_FEE':
      return 'COD collection fee';
    // The delivery fee given back on an order cancelled before it
    // shipped. A CREDIT — registered in CREDIT_DIRECTIONS above; leaving
    // it out would show the refund as a second charge.
    case 'ORDER_CHARGES_REFUND':
      return 'Cancelled order refund';
  }
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
