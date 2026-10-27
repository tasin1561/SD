'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { isStoreWalletCredit, storeWalletDirectionLabel } from '@skydrop/ui/status';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
import { useStoreWalletEntries } from '@/lib/store-wallet-hooks';
import { RmAlert, RmDir, RmSection } from './rm-parts';

/**
 * Every movement of the store's wallet, newest first, a page at a time.
 * "Show older" asks for the entries before the last one shown, so a busy
 * store's history is never cut off at a fixed number of rows.
 *
 * The direction is shown three ways — the arrow chip, the sign and the
 * colour of the figure — read from the ONE credit switch in
 * `@skydrop/ui/status`, never a local map.
 */
export function LedgerSection({
  sellerCompanyName,
  emptyDescription,
}: {
  readonly sellerCompanyName: string;
  readonly emptyDescription: string;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const entries = useStoreWalletEntries();
  const items = entries.data?.pages.flatMap((p) => p.items) ?? [];
  // Read before the success branch narrows the union: inside it the type
  // says a next-page error cannot exist, so the check would be dead code.
  const olderFailed = entries.isFetchNextPageError ? entries.failureReason : null;

  return (
    <RmSection>
      <SectionHeading title={t('walled.title')} note={t('walled.note')} />
      {entries.isPending ? (
        <SkeletonRows rows={4} cols={4} label={t('walled.loading')} />
      ) : entries.isError ? (
        <ErrorState
          message={verdict(entries.failureReason, t)}
          retry={() => void entries.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title={t('walled.empty')} description={emptyDescription} />
      ) : (
        <>
          <Table caption={t('walled.caption')}>
            <THead>
              <Tr>
                <Th>{t('walled.col.when')}</Th>
                <Th>{t('walled.col.what')}</Th>
                <Th align="right">{t('walled.col.amount')}</Th>
                <Th align="right">{t('walled.col.balance')}</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((e) => {
                const credit = isStoreWalletCredit(e.direction);
                return (
                  <Tr key={e.id}>
                    <Td className="rm-when sk-figure">{formatDateTime(e.createdAt, locale)}</Td>
                    <Td>
                      <div className="rm-type">
                        <RmDir credit={credit} />
                        <div className="rm-type__text">
                          <div>{storeWalletDirectionLabel(e.direction, sellerCompanyName)}</div>
                          {e.linkedOrderId !== null ? (
                            <Link href={`/orders/${e.linkedOrderId}`} className="rm-ref">
                              {t('walled.seeOrder')}
                            </Link>
                          ) : null}
                          {e.note !== null ? <div className="rm-faint">{e.note}</div> : null}
                        </div>
                      </div>
                    </Td>
                    <Td align="right">
                      <Money amount={e.amountInr} direction={credit ? 'credit' : 'debit'} />
                    </Td>
                    <Td align="right">
                      <Money amount={e.runningBalanceAfterInr} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <div className="rm-more">
            <p className="rm-muted">
              {entries.hasNextPage
                ? t('walled.showingLatest', { n: items.length })
                : t('walled.showingAll', { n: items.length })}
            </p>
            {entries.hasNextPage ? (
              <AsyncButton
                variant="secondary"
                size="sm"
                state={entries.isFetchingNextPage ? 'busy' : 'idle'}
                labels={{ idle: t('walled.older'), busy: t('walled.olderLoading') }}
                onClick={() => void entries.fetchNextPage()}
              />
            ) : null}
          </div>
          {olderFailed !== null ? <RmAlert>{verdict(olderFailed, t)}</RmAlert> : null}
        </>
      )}
    </RmSection>
  );
}
