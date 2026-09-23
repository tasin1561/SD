'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { buttonClassName } from '@skydrop/ui/app/button';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcCard, AcSection } from '../../../settings/_components/ac-parts';
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
 *
 * The ledger pages by cursor ("Show older") — a fixed first hundred rows
 * hid every older movement with nothing to say so.
 */
export function StoreWalletPanel({ storeId }: { readonly storeId: string }): ReactElement | null {
  const allowed = usePermission('money.view');
  const summary = useAdminStoreWallet(storeId, allowed);
  const entries = useAdminStoreWalletEntries(storeId, allowed);
  if (!allowed) return null;

  const rows = entries.data?.pages.flatMap((p) => p.items) ?? [];
  // Read before the success branch narrows the union: inside it the type
  // says a next-page error cannot exist, so the check would be dead code.
  const olderFailed = entries.isFetchNextPageError ? entries.failureReason : null;
  const fetchOlder = (): void => void entries.fetchNextPage();

  return (
    <AcSection
      title="Wallet"
      note="A ledger between the store and its seller; the cash behind it is the seller’s in our books."
      bare
      action={
        <Link
          href={`/reseller-store-wallets?storeId=${storeId}`}
          className={buttonClassName('ghost', 'sm')}
        >
          <span className="sk-btn__label">This store’s top-ups and withdrawals</span>
          <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
            <ArrowRight size={14} />
          </span>
        </Link>
      }
    >
      {summary.isPending ? (
        <SkeletonRows rows={2} cols={4} label="Loading the wallet" />
      ) : summary.isError ? (
        <ErrorState message={serverVerdict(summary.error)} retry={() => void summary.refetch()} />
      ) : (
        <div className="ac-kpis">
          <KpiCard
            label="Balance"
            figure={<Money amount={summary.data.balanceInr} size="lg" />}
            tone={Number(summary.data.balanceInr) < 0 ? 'debit' : 'neutral'}
          />
          <KpiCard
            label="Managed by"
            figure={summary.data.walletManagedBy === 'SKYDROP' ? 'Skydrop' : 'The seller'}
          />
          <KpiCard
            label="May go below zero by"
            figure={<Money amount={summary.data.negativeLimit.effectiveInr} />}
            hint={
              <>
                Seller set <Money amount={summary.data.negativeLimit.ownInr} convert={false} />; our
                cap <Money amount={summary.data.negativeLimit.capInr} convert={false} />.
              </>
            }
          />
          <KpiCard
            label="Waiting on us"
            tone={
              summary.data.pendingTopups.count + summary.data.pendingWithdrawals.count > 0
                ? 'pending'
                : 'neutral'
            }
            figure={`${summary.data.pendingTopups.count} claim(s), ${summary.data.pendingWithdrawals.count} withdrawal(s)`}
          />
        </div>
      )}
      {entries.isPending ? (
        <SkeletonRows rows={3} cols={4} label="Loading the ledger" />
      ) : entries.isError ? (
        <ErrorState message={serverVerdict(entries.error)} retry={() => void entries.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing has moved yet" />
      ) : (
        <AcCard flush>
          <Table caption="Store wallet ledger">
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Balance after</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <span className="sk-figure ac-faint">{when(e.createdAt)}</span>
                  </Td>
                  <Td>
                    <span className="ac-cell-main">
                      {storeWalletDirectionLabel(e.direction, summary.data?.sellerCompanyName)}
                    </span>
                    {e.linkedOrderId !== null ? (
                      <Link href={`/orders/${e.linkedOrderId}`} className="ac-link ac-cell-sub">
                        See the order
                      </Link>
                    ) : null}
                    {e.note !== null ? <span className="ac-cell-sub">{e.note}</span> : null}
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
          <div className="ac-pad ac-toolbar">
            <p className="ac-muted">
              {entries.hasNextPage
                ? `Showing the latest ${rows.length} movements.`
                : `Showing all ${rows.length} movements.`}
            </p>
            {entries.hasNextPage ? (
              <AsyncButton
                variant="secondary"
                size="sm"
                icon={<History size={14} />}
                state={entries.isFetchingNextPage ? 'busy' : 'idle'}
                labels={{ idle: 'Show older', busy: 'Loading…' }}
                onClick={() => void entries.fetchNextPage()}
              />
            ) : null}
          </div>
          {olderFailed !== null ? (
            <div className="ac-pad">
              <ErrorState message={serverVerdict(olderFailed)} retry={fetchOlder} />
            </div>
          ) : null}
        </AcCard>
      )}
    </AcSection>
  );
}
