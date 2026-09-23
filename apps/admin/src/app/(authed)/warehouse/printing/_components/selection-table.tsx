'use client';

import type { ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, TableEmpty, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import '../../_components/benches.css';
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
  showPrintCount = false,
}: {
  rows: readonly PrintQueueRow[];
  selected: ReadonlySet<string>;
  onToggle: (shipmentId: string) => void;
  onToggleAll: () => void;
  emptyTitle: string;
  emptyBody: string;
  /** Show how many label sheets have carried each parcel. Only useful
   *  on the reprint list, where the whole question is whether a
   *  duplicate is already out there. */
  showPrintCount?: boolean;
}): ReactElement {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.shipmentId));

  return (
    <Table caption="Parcels">
      <THead>
        <Tr>
          <Th>
            <input
              type="checkbox"
              className="wh-check"
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
          <Th align="right">COD</Th>
          <Th align="right">Items</Th>
          {showPrintCount && <Th align="right">Printed</Th>}
        </Tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={showPrintCount ? 8 : 7}>
            <div className="wh-empty-cell">
              <div className="wh-empty-cell__title">{emptyTitle}</div>
              <div className="wh-note">{emptyBody}</div>
            </div>
          </TableEmpty>
        ) : (
          rows.map((r) => (
            <Tr key={r.shipmentId} selected={selected.has(r.shipmentId)}>
              <Td>
                <input
                  type="checkbox"
                  className="wh-check"
                  checked={selected.has(r.shipmentId)}
                  onChange={() => onToggle(r.shipmentId)}
                  aria-label={`Select ${r.orderNumber}`}
                />
              </Td>
              <Td>
                <div className="sk-ident wh-item__name">{r.orderNumber}</div>
                <div className="wh-faint">{r.sellerCompanyName ?? r.shipmentNumber}</div>
              </Td>
              <Td>
                {r.isManualCourier ? (
                  <StatusChip kind="pending" label={r.courierName} size="sm" />
                ) : (
                  <span className="wh-capitalize">{r.courierName}</span>
                )}
              </Td>
              <Td>
                <span className="sk-ident">{r.awbNumber ?? '—'}</span>
              </Td>
              <Td>
                <div>{r.destCity === '' ? '—' : r.destCity}</div>
                <div className="wh-faint sk-figure">{r.destPostalCode}</div>
              </Td>
              <Td align="right">
                {r.codAmountInr === null ? '—' : <Money amount={r.codAmountInr} />}
              </Td>
              <Td align="right" className="sk-figure">
                {r.itemCount}
              </Td>
              {showPrintCount && (
                <Td align="right" className="sk-figure">
                  {/* Above one, a duplicate label may physically exist —
                      which is exactly what somebody is here to weigh
                      before adding another. */}
                  <span className={r.labelPrintCount > 1 ? 'wh-warn' : undefined}>
                    {r.labelPrintCount}×
                  </span>
                </Td>
              )}
            </Tr>
          ))
        )}
      </TBody>
    </Table>
  );
}
