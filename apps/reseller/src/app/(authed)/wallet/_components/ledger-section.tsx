'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  Section,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { isStoreWalletCredit, storeWalletDirectionLabel } from '@skydrop/ui/status';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreWalletEntries } from '@/lib/store-wallet-hooks';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Every movement of the store's wallet, newest first, a page at a time.
 * "Show older" asks for the entries before the last one shown, so a busy
 * store's history is never cut off at a fixed number of rows.
 */
export function LedgerSection({
  sellerCompanyName,
  emptyDescription,
}: {
  readonly sellerCompanyName: string;
  readonly emptyDescription: string;
}): ReactElement {
  const entries = useStoreWalletEntries();
  const items = entries.data?.pages.flatMap((p) => p.items) ?? [];
  // Read before the success branch narrows the union: inside it the type
  // says a next-page error cannot exist, so the check would be dead code.
  const olderFailed = entries.isFetchNextPageError ? entries.failureReason : null;

  return (
    <Section title="Every movement" subtitle="Newest first.">
      {entries.isPending ? (
        <LoadingState label="Loading the ledger" rows={4} />
      ) : entries.isError ? (
        <ErrorState
          message={serverVerdict(entries.failureReason)}
          retry={() => void entries.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing has moved yet" description={emptyDescription} />
      ) : (
        <>
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
              {items.map((e) => (
                <Tr key={e.id}>
                  <Td className="text-text-muted text-xs">{when(e.createdAt)}</Td>
                  <Td>
                    <div>{storeWalletDirectionLabel(e.direction, sellerCompanyName)}</div>
                    {e.linkedOrderId !== null ? (
                      <Link
                        href={`/orders/${e.linkedOrderId}`}
                        className="text-accent text-xs hover:underline"
                      >
                        See the order
                      </Link>
                    ) : null}
                    {e.note !== null ? (
                      <div className="text-text-faint text-xs">{e.note}</div>
                    ) : null}
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
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-text-muted text-xs">
              {entries.hasNextPage
                ? `Showing the latest ${items.length} movements.`
                : `Showing all ${items.length} movements.`}
            </p>
            {entries.hasNextPage ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={entries.isFetchingNextPage}
                onClick={() => void entries.fetchNextPage()}
              >
                {entries.isFetchingNextPage ? 'Loading…' : 'Show older'}
              </Button>
            ) : null}
          </div>
          {olderFailed !== null ? (
            <p role="alert" className="text-critical mt-2 text-sm">
              {serverVerdict(olderFailed)}
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}
