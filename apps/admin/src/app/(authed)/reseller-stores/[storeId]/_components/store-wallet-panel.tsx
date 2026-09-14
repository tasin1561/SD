'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  Section,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { isStoreWalletCredit, storeWalletDirectionLabel } from '@skydrop/ui/status';
import { useAdminStoreWallet, useAdminStoreWalletEntries } from '@/lib/reseller-store-wallet-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * RS-6 — one reseller store's wallet, read-only. Money is `money.view`, a
 * narrower gate than the store page's own, so the panel asks before it
 * fetches and is simply absent for somebody without it.
 */
export function StoreWalletPanel({ storeId }: { readonly storeId: string }): ReactElement | null {
  const allowed = usePermission('money.view');
  const summary = useAdminStoreWallet(storeId, allowed);
  const entries = useAdminStoreWalletEntries(storeId, allowed);
  if (!allowed) return null;

  return (
    <Section
      title="Wallet"
      subtitle="A ledger between the store and its seller; the cash behind it is the seller’s in our books."
      action={
        <Link href="/reseller-store-wallets" className="text-accent text-sm hover:underline">
          Store wallet queues →
        </Link>
      }
    >
      {summary.isPending ? (
        <LoadingState label="Loading the wallet" rows={2} />
      ) : summary.isError ? (
        <ErrorState message={serverVerdict(summary.error)} retry={() => void summary.refetch()} />
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Balance"
            value={<Money amount={summary.data.balanceInr} size="lg" />}
            tone={Number(summary.data.balanceInr) < 0 ? 'bad' : 'neutral'}
          />
          <Stat
            label="Managed by"
            value={summary.data.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'The seller'}
          />
          <Stat
            label="May go below zero by"
            value={<Money amount={summary.data.negativeLimit.effectiveInr} />}
            hint={`Seller set ₹${summary.data.negativeLimit.ownInr}; our cap ₹${summary.data.negativeLimit.capInr}.`}
          />
          <Stat
            label="Waiting on us"
            value={`${summary.data.pendingTopups.count} claim(s), ${summary.data.pendingWithdrawals.count} withdrawal(s)`}
          />
        </div>
      )}
      {entries.isPending ? (
        <LoadingState label="Loading the ledger" rows={3} />
      ) : entries.isError ? (
        <ErrorState message={serverVerdict(entries.error)} retry={() => void entries.refetch()} />
      ) : entries.data.items.length === 0 ? (
        <EmptyState title="Nothing has moved yet" />
      ) : (
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
            {entries.data.items.map((e) => (
              <Tr key={e.id}>
                <Td className="text-text-muted text-xs">{when(e.createdAt)}</Td>
                <Td>
                  <div>
                    {storeWalletDirectionLabel(e.direction, summary.data?.sellerCompanyName)}
                  </div>
                  {e.note !== null ? <div className="text-text-faint text-xs">{e.note}</div> : null}
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
      )}
    </Section>
  );
}
