'use client';

import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Table, TBody, TableEmpty, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import '../../_components/benches.css';
import { useOpenRtoShipments } from '@/lib/api-hooks';
import { useT } from '@/i18n/client';

/**
 * What is sitting on the returns bench.
 *
 * Two things stop a return moving, and they need different responses, so
 * they are counted separately rather than rolled into one "needs
 * attention" number: items nobody has inspected yet, and items an
 * operator looked at and could not decide about. The second is the more
 * interesting one — until somebody chooses, those goods are neither
 * sellable nor written off.
 *
 * Clicking a row loads it into the station below rather than navigating
 * away: the supervisor scanning this list is the same person who will
 * work it.
 */
export function OpenReturns({
  onPick,
}: {
  readonly onPick: (shipmentId: string) => void;
}): ReactElement {
  const t = useT();
  const open = useOpenRtoShipments();

  return (
    <>
      {open.isLoading ? (
        <section className="wh-card">
          <SkeletonRows rows={3} cols={5} label={t('warehouseRtoOpenReturns.readingTheBench')} />
        </section>
      ) : open.isError || open.data === undefined ? (
        <section className="wh-card">
          <p className="wh-note">{t('warehouseRtoOpenReturns.couldNotReadOpenReturns')}</p>
        </section>
      ) : (
        <Table caption={t('warehouseRtoOpenReturns.returnsOnTheBench')}>
          <THead>
            <Tr>
              <Th>{t('warehouseRtoOpenReturns.parcel')}</Th>
              <Th>{t('warehouseRtoOpenReturns.client')}</Th>
              <Th>{t('warehouseRtoOpenReturns.received')}</Th>
              <Th>{t('warehouseRtoOpenReturns.items')}</Th>
              <Th align="right">{t('warehouseRtoOpenReturns.open')}</Th>
            </Tr>
          </THead>
          <TBody>
            {open.data.items.length === 0 ? (
              <TableEmpty colSpan={5}>
                {t('warehouseRtoOpenReturns.nothingWaitingAReturnAppears')}
              </TableEmpty>
            ) : (
              open.data.items.map((r) => (
                <Tr key={r.shipmentId}>
                  <Td>
                    <div className="sk-ident wh-item__name">{r.awbNumber ?? r.shipmentNumber}</div>
                    <div className="sk-ident wh-faint">{r.orderNumber ?? ''}</div>
                  </Td>
                  <Td className="wh-note">{r.sellerName ?? '—'}</Td>
                  <Td className="sk-figure wh-note wh-nowrap">
                    {r.rtoReceivedAt === null
                      ? '—'
                      : new Date(r.rtoReceivedAt).toLocaleDateString()}
                  </Td>
                  <Td>
                    <span className="sk-figure">{r.itemCount}</span>
                    {r.uninspectedCount > 0 && (
                      <span className="wh-note">
                        {' '}
                        {t('warehouseRtoOpenReturns.uninspected', {
                          uninspectedCount: r.uninspectedCount,
                        })}
                      </span>
                    )}
                    {r.undecidedCount > 0 && (
                      <span className="wh-warn">
                        {' · '}
                        <AlertTriangle size={12} aria-hidden />
                        {t('warehouseRtoOpenReturns.undecided', {
                          undecidedCount: r.undecidedCount,
                        })}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <Button variant="secondary" size="sm" onClick={() => onPick(r.shipmentId)}>
                      {t('warehouseRtoOpenReturns.workIt')}
                    </Button>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      )}
    </>
  );
}
