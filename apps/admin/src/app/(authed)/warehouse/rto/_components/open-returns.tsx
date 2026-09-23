'use client';

import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Table, TBody, TableEmpty, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import '../../_components/benches.css';
import { useOpenRtoShipments } from '@/lib/api-hooks';

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
  const open = useOpenRtoShipments();

  return (
    <>
      {open.isLoading ? (
        <section className="wh-card">
          <SkeletonRows rows={3} cols={5} label="Reading the bench…" />
        </section>
      ) : open.isError || open.data === undefined ? (
        <section className="wh-card">
          <p className="wh-note">
            Could not read open returns. The station below still works if you have an AWB.
          </p>
        </section>
      ) : (
        <Table caption="Returns on the bench">
          <THead>
            <Tr>
              <Th>Parcel</Th>
              <Th>Seller</Th>
              <Th>Received</Th>
              <Th>Items</Th>
              <Th align="right">Open</Th>
            </Tr>
          </THead>
          <TBody>
            {open.data.items.length === 0 ? (
              <TableEmpty colSpan={5}>
                Nothing waiting. A return appears here once it has been received and until it is
                finalised.
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
                      <span className="wh-note"> · {r.uninspectedCount} uninspected</span>
                    )}
                    {r.undecidedCount > 0 && (
                      <span className="wh-warn">
                        {' · '}
                        <AlertTriangle size={12} aria-hidden />
                        {r.undecidedCount} undecided
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <Button variant="secondary" size="sm" onClick={() => onPick(r.shipmentId)}>
                      Work it
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
