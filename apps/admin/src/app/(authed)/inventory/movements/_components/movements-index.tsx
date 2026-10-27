'use client';

import { useState, type ReactElement } from 'react';
import { StockMovementType } from '@skydrop/db';
import { Ident, Num } from '@skydrop/ui/components';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { useWarehouseOptions } from '@/lib/ops-hooks';
import { useBinOptions } from '@/lib/bin-contents-hooks';
import { useMovementsList, type StockMovementView } from '@/lib/inventory-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  AreaPage,
  InlineError,
  PanelPad,
  Stack,
  ToneText,
  Toolbar,
} from '../../_components/stock-kit';
import { useT } from '@/i18n/client';

const PAGE_SIZE = 50;

/**
 * The stock movement ledger.
 *
 * `stock_movements` is append-only and is the record of why a quantity
 * is what it is — every receipt, dispatch, adjustment and return, in
 * order. It is the thing you read when a number looks wrong and nobody
 * can explain it, so this screen is read-only by construction: there is
 * no endpoint to edit a movement and there should never be one.
 *
 * Filters exist because the unfiltered ledger is enormous and mostly
 * not about your problem. The variant filter answers "what happened to
 * this SKU"; the bin filter answers "how did this shelf come to hold
 * that" — reached from a bin's own page with both ids in the URL.
 */
export function MovementsIndex({
  initialWarehouseId = '',
  initialBinId = '',
}: {
  readonly initialWarehouseId?: string;
  readonly initialBinId?: string;
}): ReactElement {
  const tr = useT();
  const warehouses = useWarehouseOptions();
  const [variantId, setVariantId] = useState('');
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId);
  const [binId, setBinId] = useState(initialBinId);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const bins = useBinOptions(warehouseId);

  const list = useMovementsList({
    ...(variantId.trim() === '' ? {} : { variantId: variantId.trim() }),
    ...(warehouseId === '' ? {} : { warehouseId }),
    ...(binId === '' ? {} : { binId }),
    ...(type === '' ? {} : { type }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  // A bin arriving from the URL may not be in the options (they load per
  // warehouse, and need warehouse.view) — keep it selectable by the code
  // the rows themselves carry, so the filter never silently shows "All".
  const binOptions = bins.data ?? [];
  const selectedFromRows =
    binId !== '' && !binOptions.some((b) => b.id === binId)
      ? (items.find((m) => m.binId === binId)?.binCode ??
        tr('inventoryMovementsMovementsIndex.selectedBin'))
      : null;

  function change(apply: () => void): void {
    apply();
    setPage(1);
  }

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[
          { label: tr('inventoryMovementsMovementsIndex.inventory') },
          { label: tr('inventoryMovementsMovementsIndex.movements') },
        ]}
        title={tr('inventoryMovementsMovementsIndex.stockMovements')}
        subtitle={tr('inventoryMovementsMovementsIndex.appendOnlyEveryChangeTo')}
      />

      <Stack>
        <Toolbar>
          <TextField
            id="mv-variant"
            label={tr('inventoryMovementsMovementsIndex.variantId')}
            inputClassName="sk-ident"
            value={variantId}
            onChange={(e) => change(() => setVariantId(e.target.value))}
            placeholder={tr('inventoryMovementsMovementsIndex.pasteAVariantIdTo')}
          />
          <Select
            id="mv-wh"
            label={tr('inventoryMovementsMovementsIndex.warehouse')}
            value={warehouseId}
            onChange={(e) =>
              change(() => {
                setWarehouseId(e.target.value);
                // A bin belongs to one warehouse; keeping it would filter
                // the new warehouse down to nothing.
                setBinId('');
              })
            }
          >
            <option value="">{tr('inventoryMovementsMovementsIndex.allWarehouses')}</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Select
            id="mv-bin"
            label={tr('inventoryMovementsMovementsIndex.bin')}
            value={binId}
            disabled={warehouseId === '' && binId === ''}
            onChange={(e) => change(() => setBinId(e.target.value))}
          >
            <option value="">
              {warehouseId === ''
                ? tr('inventoryMovementsMovementsIndex.pickAWarehouse')
                : tr('inventoryMovementsMovementsIndex.allBins')}
            </option>
            {selectedFromRows !== null && <option value={binId}>{selectedFromRows}</option>}
            {binOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </Select>
          <Select
            id="mv-type"
            label={tr('inventoryMovementsMovementsIndex.type')}
            value={type}
            onChange={(e) => change(() => setType(e.target.value))}
          >
            <option value="">{tr('inventoryMovementsMovementsIndex.allTypes')}</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Toolbar>

        {list.isLoading ? (
          <SkeletonRows rows={8} cols={8} />
        ) : list.isError ? (
          <InlineError message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={tr('inventoryMovementsMovementsIndex.noMovementsMatch')}
            description={tr('inventoryMovementsMovementsIndex.widenTheFiltersOrCheck')}
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>{tr('inventoryMovementsMovementsIndex.when')}</Th>
                  <Th>{tr('inventoryMovementsMovementsIndex.type')}</Th>
                  <Th>{tr('inventoryMovementsMovementsIndex.variant')}</Th>
                  <Th>{tr('inventoryMovementsMovementsIndex.bin')}</Th>
                  <Th align="right">{tr('inventoryMovementsMovementsIndex.change')}</Th>
                  <Th align="right">{tr('inventoryMovementsMovementsIndex.after')}</Th>
                  <Th>{tr('inventoryMovementsMovementsIndex.reason')}</Th>
                  <Th>{tr('inventoryMovementsMovementsIndex.causedBy')}</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((m) => (
                  <Tr key={m.id}>
                    <Td className="sk-figure stk-nowrap">
                      {new Date(m.createdAt).toLocaleString('en-IN')}
                    </Td>
                    <Td>{m.type.replace(/_/g, ' ').toLowerCase()}</Td>
                    <Td>
                      <Ident value={m.variantId} />
                    </Td>
                    <Td>
                      <BinCell m={m} />
                    </Td>
                    <Td align="right" className="sk-figure">
                      {m.qtyChange < 0 ? (
                        <ToneText tone="bad">{m.qtyChange}</ToneText>
                      ) : (
                        <span>
                          {m.qtyChange > 0 ? '+' : ''}
                          {m.qtyChange}
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="sk-figure">
                      {m.qtyAfter === null ? '—' : <Num value={m.qtyAfter} />}
                    </Td>
                    <Td>{m.reasonCode ?? '—'}</Td>
                    <Td>{cause(m)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <PanelPad>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </PanelPad>
          </>
        )}
      </Stack>
    </AreaPage>
  );
}

/** "R-01-01 · CCU-01" — the code somebody can walk to, not a uuid. */
function BinCell({ m }: { readonly m: StockMovementView }): ReactElement {
  if (m.binId === null) return <span className="stk-faint">—</span>;
  if (m.binCode === null) return <Ident value={m.binId} />;
  return (
    <span>
      <span className="sk-ident">{m.binCode}</span>
      {m.warehouseCode !== null && <span className="stk-muted"> · {m.warehouseCode}</span>}
    </span>
  );
}

/**
 * Which upstream record explains this row — SAYING WHICH KIND IT IS.
 *
 * All three of these are uuids and they used to render identically, so
 * the one column on this screen whose entire job is to answer "what
 * caused it" answered with thirty-six characters that could equally be
 * an order, a parcel or a correction. Three different places to go and
 * look, and nothing on the row said which. The row already knows: only
 * one of the three fields is set. `BinCell` directly above has the same
 * argument in its own comment — the code somebody can walk to, not a
 * uuid — and this is that one step further: the id is still here to
 * paste, with the word that says where to paste it.
 */
function cause(m: {
  orderId: string | null;
  shipmentId: string | null;
  adjustmentId: string | null;
}): ReactElement {
  if (m.orderId !== null) return <Caused kind="order" id={m.orderId} />;
  if (m.shipmentId !== null) return <Caused kind="parcel" id={m.shipmentId} />;
  if (m.adjustmentId !== null) return <Caused kind="adjustment" id={m.adjustmentId} />;
  return <span className="stk-faint">—</span>;
}

function Caused({ kind, id }: { readonly kind: string; readonly id: string }): ReactElement {
  return (
    <span>
      <span className="stk-muted">{kind} </span>
      <Ident value={id} />
    </span>
  );
}

/**
 * EVERY kind, DERIVED — never a hand-kept copy of the enum.
 *
 * It was a literal of thirteen, and the schema has fourteen: it was
 * missing `PACK_REVERSED`, the give-back that returns a packed parcel's
 * stock when its order is cancelled before the courier ever takes it
 * (CUR-3). That is the one movement an operator is most likely to come
 * here hunting for — "we cancelled it, did the stock come back?" — and
 * the filter simply had no entry for it, while the rows themselves
 * showed up perfectly in the unfiltered list. Nothing failed; the list
 * was quietly short.
 *
 * `Object.values` is in schema declaration order, which is lifecycle
 * order, which is what the hand-written list was reaching for anyway.
 * A fifteenth kind now appears here the day it is added.
 */
const MOVEMENT_TYPES = Object.values(StockMovementType);
