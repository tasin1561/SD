'use client';

import type { ReactElement } from 'react';
import {
  Money,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import type { PrintQueueRow } from '@/lib/ops-hooks';

/**
 * The queue both tabs work from.
 *
 * One component because the two lists ARE the same list at different
 * stages, and giving them separate tables would let them drift into
 * showing different facts about the same parcel.
 *
 * The checkbox column is a real `<th>`/`<td>` rather than an overlay, so
 * the mobile card layout (FE-7) stamps it a label like every other cell
 * instead of rendering a floating tick with no name.
 */
export function SelectionTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  emptyTitle,
  emptyBody,
}: {
  rows: readonly PrintQueueRow[];
  selected: ReadonlySet<string>;
  onToggle: (shipmentId: string) => void;
  onToggleAll: () => void;
  emptyTitle: string;
  emptyBody: string;
}): ReactElement {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.shipmentId));

  return (
    <Table>
      <THead>
        <Tr>
          <Th>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              aria-label={allSelected ? 'Clear selection' : 'Select every parcel'}
              disabled={rows.length === 0}
            />
          </Th>
          <Th>Order</Th>
          <Th>Courier</Th>
          <Th>AWB</Th>
          <Th>Destination</Th>
          <Th>COD</Th>
          <Th>Items</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={7}>
            <div className="flex flex-col items-center gap-1.5 py-2">
              <div className="font-medium">{emptyTitle}</div>
              <div className="text-xs text-text-muted">{emptyBody}</div>
            </div>
          </TableEmpty>
        ) : (
          rows.map((r) => (
            <Tr key={r.shipmentId}>
              <Td>
                <input
                  type="checkbox"
                  checked={selected.has(r.shipmentId)}
                  onChange={() => onToggle(r.shipmentId)}
                  aria-label={`Select ${r.orderNumber}`}
                />
              </Td>
              <Td>
                <div className="font-medium">{r.orderNumber}</div>
                <div className="text-xs text-text-muted">
                  {r.sellerCompanyName ?? r.shipmentNumber}
                </div>
              </Td>
              <Td>
                {r.isManualCourier ? (
                  <StatusBadge kind="pending" label={r.courierName} />
                ) : (
                  <span className="capitalize">{r.courierName}</span>
                )}
              </Td>
              <Td>
                <span className="font-mono text-xs">{r.awbNumber ?? '—'}</span>
              </Td>
              <Td>
                <div>{r.destCity === '' ? '—' : r.destCity}</div>
                <div className="text-xs text-text-muted tabular-nums">{r.destPostalCode}</div>
              </Td>
              <Td>{r.codAmountInr === null ? '—' : <Money amount={r.codAmountInr} />}</Td>
              <Td className="tabular-nums">{r.itemCount}</Td>
            </Tr>
          ))
        )}
      </TBody>
    </Table>
  );
}
