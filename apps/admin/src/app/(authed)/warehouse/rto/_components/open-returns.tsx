'use client';

import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  Section,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
    <Section title="Waiting on somebody">
      {open.isLoading ? (
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">Reading the bench…</p>
          </CardBody>
        </Card>
      ) : open.isError || open.data === undefined ? (
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">
              Could not read open returns. The station below still works if you have an AWB.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Table>
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
                    <div className="font-mono text-xs">{r.awbNumber ?? r.shipmentNumber}</div>
                    <div className="text-text-faint text-xs">{r.orderNumber ?? ''}</div>
                  </Td>
                  <Td className="text-text-muted">{r.sellerName ?? '—'}</Td>
                  <Td className="text-text-muted whitespace-nowrap text-xs">
                    {r.rtoReceivedAt === null
                      ? '—'
                      : new Date(r.rtoReceivedAt).toLocaleDateString()}
                  </Td>
                  <Td className="text-xs">
                    <span className="tabular-nums">{r.itemCount}</span>
                    {r.uninspectedCount > 0 && (
                      <span className="text-text-muted"> · {r.uninspectedCount} uninspected</span>
                    )}
                    {r.undecidedCount > 0 && (
                      <span className="text-warning inline-flex items-center gap-1">
                        {' · '}
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {r.undecidedCount} undecided
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <Button variant="ghost" size="sm" onClick={() => onPick(r.shipmentId)}>
                      Work it
                    </Button>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
