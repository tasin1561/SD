'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@skydrop/ui/components';
import { useWalletBalances, useWalletEntries } from '@/lib/api-hooks';
import type { WalletEntryView } from '@skydrop/api-client';

/**
 * Phase 1B M24 — seller wallet. Top: balance cards (INR + BDT).
 * Below: paginated ledger with filter chips. Each entry's
 * linkedOrder column is a click-through to the order detail.
 *
 * No mutation surface here — sellers can't initiate remits (admin
 * does it). They just see the books.
 */
export default function WalletPage(): ReactElement {
  const [filter, setFilter] = useState<'all' | 'INR' | 'BDT'>('all');
  const balances = useWalletBalances();
  const entries = useWalletEntries(filter === 'all' ? undefined : filter);

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title="Wallet"
        subtitle="What's owed to you. COD net of charges per delivered order; remittances debit as we pay you out."
      />

      <div className="grid grid-cols-2 gap-3">
        {balances.isLoading ? (
          <LoadingState label="Loading balances…" />
        ) : balances.isError ? (
          <ErrorState message={balances.error?.message ?? 'Failed.'} />
        ) : (
          (balances.data?.balances ?? []).map((b) => (
            <Card key={b.currency}>
              <CardBody>
                <div className="text-text-faint text-xs uppercase tracking-wide mb-1">
                  {b.currency}
                </div>
                <div className="text-text-bright text-2xl font-medium tracking-tight font-mono">
                  {formatMoney(b.balance, b.currency)}
                </div>
                <div className="text-text-muted text-xs mt-1">
                  {Number(b.balance) === 0
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

      <Card>
        <CardHeader
          title="Ledger"
          action={
            <div className="flex items-center gap-1 text-xs">
              {(['all', 'INR', 'BDT'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={
                    'px-2 py-0.5 rounded-[4px] transition-colors ' +
                    (filter === f
                      ? 'bg-surface border border-border text-text-bright'
                      : 'text-text-muted hover:text-text-body')
                  }
                >
                  {f}
                </button>
              ))}
            </div>
          }
        />
        <CardBody>
          {entries.isLoading ? (
            <LoadingState label="Loading ledger…" />
          ) : entries.isError ? (
            <ErrorState message={entries.error?.message ?? 'Failed.'} />
          ) : !entries.data || entries.data.items.length === 0 ? (
            <div className="text-text-muted text-sm py-4">
              No ledger entries yet. Once an order delivers (COD), your
              wallet will accrue (COD amount − shipping + GST).
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Linked</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-right px-3 py-2 font-medium">Balance after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.data.items.map((e) => (
                  <LedgerRow key={e.id} entry={e} />
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <div className="text-text-faint text-xs">
        Remittances are paid to the bank account on your profile. Update
        your bank details on{' '}
        <Link href="/profile" className="text-accent hover:underline">
          /profile
        </Link>{' '}
        before requesting your first payout.
      </div>
    </div>
  );
}

function LedgerRow({ entry }: { readonly entry: WalletEntryView }): ReactElement {
  const isCredit =
    entry.direction === 'COD_COLLECTION' ||
    entry.direction === 'REMITTANCE_FX' ||
    entry.direction === 'ADJUSTMENT_CREDIT' ||
    entry.direction === 'OPENING_BALANCE';
  const sign = isCredit ? '+' : '−';
  const color = isCredit ? 'text-accent' : 'text-critical';
  return (
    <tr>
      <td className="px-3 py-2 text-text-muted font-mono text-xs">
        {new Date(entry.createdAt).toLocaleString()}
      </td>
      <td className="px-3 py-2 text-text-body text-xs">
        {humanizeDirection(entry.direction)}
        {entry.note && (
          <div className="text-text-faint text-[11px] mt-0.5 italic">
            {entry.note}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-text-body text-xs">
        {entry.linkedOrderId ? (
          <Link
            href={`/orders/${entry.linkedOrderId}`}
            className="text-accent hover:underline font-mono text-[11px]"
          >
            Order →
          </Link>
        ) : entry.linkedRemittanceId ? (
          <span className="text-text-muted text-[11px]">Remittance</span>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={`px-3 py-2 text-right font-mono ${color}`}>
        {sign}
        {formatMoney(entry.amount, entry.currency)}
      </td>
      <td className="px-3 py-2 text-right text-text-body font-mono text-xs">
        {formatMoney(entry.runningBalanceAfter, entry.currency)}
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
  }
}

function formatMoney(value: string, currency: string): string {
  const n = Number(value);
  return `${currency === 'INR' ? '₹' : '৳'} ${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
