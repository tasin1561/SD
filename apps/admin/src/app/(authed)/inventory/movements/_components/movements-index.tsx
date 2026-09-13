'use client';

import { useState, type ReactElement } from 'react';
import {
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Num,
  PageHeader,
  Select,
  SkeletonRows,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import { useWarehouseOptions } from '@/lib/ops-hooks';
import { useBinOptions } from '@/lib/bin-contents-hooks';
import { useMovementsList, type StockMovementView } from '@/lib/inventory-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
      ? (items.find((m) => m.binId === binId)?.binCode ?? 'Selected bin')
      : null;

  function change(apply: () => void): void {
    apply();
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Stock movements"
        subtitle="Append-only. Every change to a quantity, and what caused it. Read this when a number does not add up."
      />

      <Toolbar>
        <FormField label="Variant id" htmlFor="mv-variant" className="w-72">
          <Input
            id="mv-variant"
            value={variantId}
            onChange={(e) => change(() => setVariantId(e.target.value))}
            placeholder="Paste a variant id to trace one SKU"
          />
        </FormField>
        <FormField label="Warehouse" htmlFor="mv-wh" className="w-56">
          <Select
            id="mv-wh"
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
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Bin" htmlFor="mv-bin" className="w-48">
          <Select
            id="mv-bin"
            value={binId}
            disabled={warehouseId === '' && binId === ''}
            onChange={(e) => change(() => setBinId(e.target.value))}
          >
            <option value="">{warehouseId === '' ? 'Pick a warehouse' : 'All bins'}</option>
            {selectedFromRows !== null && <option value={binId}>{selectedFromRows}</option>}
            {binOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Type" htmlFor="mv-type" className="w-56">
          <Select id="mv-type" value={type} onChange={(e) => change(() => setType(e.target.value))}>
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </FormField>
      </Toolbar>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={8} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No movements match"
            description="Widen the filters, or check the variant id — an id that does not exist looks exactly like a SKU that never moved."
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>When</Th>
                  <Th>Type</Th>
                  <Th>Variant</Th>
                  <Th>Bin</Th>
                  <Th align="right">Change</Th>
                  <Th align="right">After</Th>
                  <Th>Reason</Th>
                  <Th>Caused by</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((m) => (
                  <Tr key={m.id}>
                    <Td>{new Date(m.createdAt).toLocaleString('en-IN')}</Td>
                    <Td>{m.type.replace(/_/g, ' ').toLowerCase()}</Td>
                    <Td>
                      <Ident value={m.variantId} />
                    </Td>
                    <Td>
                      <BinCell m={m} />
                    </Td>
                    <Td align="right">
                      <span className={m.qtyChange < 0 ? 'text-[var(--color-bad)]' : ''}>
                        {m.qtyChange > 0 ? '+' : ''}
                        {m.qtyChange}
                      </span>
                    </Td>
                    <Td align="right">{m.qtyAfter === null ? '—' : <Num value={m.qtyAfter} />}</Td>
                    <Td>{m.reasonCode ?? '—'}</Td>
                    <Td>{cause(m)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

/** "R-01-01 · CCU-01" — the code somebody can walk to, not a uuid. */
function BinCell({ m }: { readonly m: StockMovementView }): ReactElement {
  if (m.binId === null) return <span className="text-text-faint">—</span>;
  if (m.binCode === null) return <Ident value={m.binId} />;
  return (
    <span>
      <span className="font-mono">{m.binCode}</span>
      {m.warehouseCode !== null && <span className="text-text-muted"> · {m.warehouseCode}</span>}
    </span>
  );
}

/** Which upstream record explains this row. */
function cause(m: {
  orderId: string | null;
  shipmentId: string | null;
  adjustmentId: string | null;
}): ReactElement {
  if (m.orderId !== null) return <Ident value={m.orderId} />;
  if (m.shipmentId !== null) return <Ident value={m.shipmentId} />;
  if (m.adjustmentId !== null) return <Ident value={m.adjustmentId} />;
  return <span className="text-text-faint">—</span>;
}

const MOVEMENT_TYPES = [
  'RECEIVING',
  'PUT_AWAY',
  'PICK',
  'PACK_CONFIRM',
  'DISPATCH',
  'RETURN_RECEIVE',
  'RETURN_RESTOCK',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CYCLE_COUNT_ADJUST',
  'EXPIRY_WRITE_OFF',
] as const;
