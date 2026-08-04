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
import { useMovementsList } from '@/lib/inventory-hooks';
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
 * not about your problem. The variant filter is the one people actually
 * use — "what happened to this SKU".
 */
export function MovementsIndex(): ReactElement {
  const warehouses = useWarehouseOptions();
  const [variantId, setVariantId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);

  const list = useMovementsList({
    ...(variantId.trim() === '' ? {} : { variantId: variantId.trim() }),
    ...(warehouseId === '' ? {} : { warehouseId }),
    ...(type === '' ? {} : { type }),
    page,
    pageSize: PAGE_SIZE,
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

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
            onChange={(e) => change(() => setWarehouseId(e.target.value))}
          >
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
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
                    <Td>{m.binId === null ? '—' : <Ident value={m.binId} />}</Td>
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
