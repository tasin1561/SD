'use client';

import { Fragment, type ReactElement, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { PendingCompactRow } from '@skydrop/api-client';
import {
  SelectAllTh,
  SelectTd,
  Table,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  type RowSelection,
} from '@skydrop/ui/app/data-table';
import { BulkSelectStrip } from '@skydrop/ui/app/bulk-actions';
import { useUiT } from '@skydrop/ui/app/i18n-client';
import { useT } from '@/i18n/client';
import { ResultChip, type RowOutcome } from './pending-results';

const COLUMNS = 8;

/**
 * The compact list: one line per waiting row, straight from
 * `GET /seller/orders-pending/compact`.
 *
 * A row opens in place — the same editor the page always had, under the
 * line it belongs to — so the list stays the map and the editor is never a
 * different screen. The whole line is the target; the chevron button is the
 * keyboard and screen-reader way in and carries the open state.
 *
 * On a phone each line is a card: row number and reference on top, the tick
 * in the corner, the values under it, and the open editor as the card below.
 */
export function PendingTable({
  rows,
  selection,
  openId,
  onToggle,
  outcomes,
  renderOpen,
}: {
  readonly rows: readonly PendingCompactRow[];
  readonly selection: RowSelection;
  readonly openId: string | null;
  readonly onToggle: (rowId: string) => void;
  readonly outcomes: ReadonlyMap<string, RowOutcome>;
  /** The editor for the open row. */
  readonly renderOpen: (rowId: string) => ReactNode;
}): ReactElement {
  const t = useT();
  const uiT = useUiT();
  return (
    <div className="ez-cards ez-lead-2 sk-bulk-table pend-table">
      <BulkSelectStrip selection={selection} />
      <Table caption={t('orderPending.listTitle')}>
        <THead>
          <Tr>
            <SelectAllTh selection={selection} label={uiT('ui.bulk.selectPage')} />
            <Th>{t('orderPending.colRow')}</Th>
            <Th>{t('orderPending.colCustomer')}</Th>
            <Th>{t('orderPending.colPin')}</Th>
            <Th>{t('orderPending.colSku')}</Th>
            <Th align="right">{t('orderPending.colCod')}</Th>
            <Th>{t('orderPending.colToFix')}</Th>
            <Th align="right" data-label="">
              <span className="ord-sr">{t('orderPending.rowsNav')}</span>
            </Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => {
            const open = r.id === openId;
            const outcome = outcomes.get(r.id);
            return (
              <Fragment key={r.id}>
                <Tr
                  id={`pend-row-${r.id}`}
                  className="pend-line"
                  data-open={open ? '1' : undefined}
                  selected={selection.isSelected(r.id)}
                  onActivate={() => onToggle(r.id)}
                >
                  <SelectTd
                    selection={selection}
                    id={r.id}
                    label={uiT('ui.bulk.selectRow', {
                      name: t('orderPending.resRow', { n: r.rowNumber }),
                    })}
                  />
                  <Td>
                    <span className="pend-rowno sk-figure">
                      {t('orderPending.resRow', { n: r.rowNumber })}
                    </span>
                    {r.externalRef !== '' && (
                      <span className="ord-sub sk-ident">{r.externalRef}</span>
                    )}
                  </Td>
                  <Td>
                    {r.customerName === '' && r.phone === '' ? null : (
                      <>
                        <span className="pend-name">{r.customerName || '—'}</span>
                        {r.phone !== '' && <span className="ord-sub sk-figure">{r.phone}</span>}
                      </>
                    )}
                  </Td>
                  <Td>
                    {r.pinCode === '' ? null : <span className="sk-figure">{r.pinCode}</span>}
                  </Td>
                  <Td>
                    {r.sku === '' ? null : (
                      <span className="pend-sku">
                        <span className="sk-ident">{r.sku}</span>
                        {r.qty !== '' && <span className="ord-faint sk-figure"> × {r.qty}</span>}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    {r.codAmount === '' ? null : <span className="sk-figure">{r.codAmount}</span>}
                  </Td>
                  <Td>
                    <span className="pend-state">
                      {r.status === 'DUPLICATE_SUSPECTED' && (
                        <span className="pend-chip" data-tone="warn">
                          {t('orderPending.duplicateChip')}
                        </span>
                      )}
                      {r.problemCount > 0 ? (
                        <span className="pend-chip" data-tone="bad">
                          {t('orderPending.toFixN', { n: r.problemCount })}
                        </span>
                      ) : (
                        r.status !== 'DUPLICATE_SUSPECTED' && (
                          <span className="pend-chip" data-tone="good">
                            {t('orderPending.toFixNone')}
                          </span>
                        )
                      )}
                      {outcome !== undefined && <ResultChip outcome={outcome} />}
                    </span>
                  </Td>
                  <Td align="right" className="pend-chev-cell">
                    <button
                      type="button"
                      className="pend-chev"
                      aria-expanded={open}
                      aria-controls={`pend-open-${r.id}`}
                      aria-label={
                        open
                          ? t('orderPending.closeRow', { n: r.rowNumber })
                          : t('orderPending.openRow', { n: r.rowNumber })
                      }
                      onClick={() => onToggle(r.id)}
                    >
                      <ChevronDown size={18} aria-hidden />
                    </button>
                  </Td>
                </Tr>
                {open && (
                  <tr className="pend-open" id={`pend-open-${r.id}`}>
                    <td colSpan={COLUMNS} className="pend-open__cell">
                      {renderOpen(r.id)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
