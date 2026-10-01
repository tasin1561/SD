/**
 * The stock movement ledger's two columns of record — what caused a
 * movement, and which kinds there are to filter by. Both were found by
 * filming the page (L3, 2026-10-01), and neither failed anything: one
 * printed a uuid with no clue what it named, the other quietly offered
 * thirteen of fourteen kinds.
 *
 * ── The "Caused by" column ───────────────────────────────────────────
 *
 * A movement is caused by exactly one of three things — an order, a
 * parcel or a stock adjustment — and all three are uuids. Rendered as
 * bare ids they are indistinguishable, which leaves the one column on
 * this screen whose job is to answer "what caused it" answering with
 * thirty-six characters and no clue which of three places to go and
 * look. Found by filming it (L3, 2026-10-01).
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StockMovementType } from '@skydrop/db';

const BASE = {
  createdAt: '2026-10-01T10:00:00.000Z',
  sellerId: 's-1',
  variantId: '01a0eb0e-e98a-7c5e-8b17-c0fc9bd07fc5',
  warehouseId: 'w-1',
  warehouseCode: 'CCU-01',
  binId: 'b-1',
  binCode: 'A-01-01',
  batchId: null,
  qtyAfter: 4,
  reasonCode: null,
  orderId: null,
  shipmentId: null,
  adjustmentId: null,
  performedByStaffId: null,
};

const ORDER_ID = '01a0f67c-917c-7f8b-ab8b-228bef4d6907';
const SHIPMENT_ID = '01a0f629-0a14-70de-b872-14e0501c8add';
const ADJUSTMENT_ID = '01a0f638-c807-71b5-a7fc-3d9bb85e477f';

const ITEMS = [
  { ...BASE, id: 'm-1', type: 'PACK_CONFIRM', qtyChange: -2, orderId: ORDER_ID },
  { ...BASE, id: 'm-2', type: 'RETURN_RECEIVE', qtyChange: 2, shipmentId: SHIPMENT_ID },
  {
    ...BASE,
    id: 'm-3',
    type: 'ADJUSTMENT_DECREASE',
    qtyChange: -1,
    reasonCode: 'COUNTING_ERROR',
    adjustmentId: ADJUSTMENT_ID,
  },
  { ...BASE, id: 'm-4', type: 'RECEIVING', qtyChange: 22 },
];

vi.mock('@/lib/inventory-hooks', () => ({
  useMovementsList: () => ({
    isLoading: false,
    isError: false,
    data: { items: ITEMS, total: ITEMS.length },
  }),
}));
vi.mock('@/lib/ops-hooks', () => ({ useWarehouseOptions: () => ({ data: [] }) }));
vi.mock('@/lib/bin-contents-hooks', () => ({ useBinOptions: () => ({ data: [] }) }));

import { MovementsIndex } from '../app/(authed)/inventory/movements/_components/movements-index';

/** The last cell of the row holding this id — "Caused by" is the eighth column. */
function causedBy(id: string): HTMLElement {
  const row = screen.getByText(id).closest('tr');
  if (row === null) throw new Error(`no row carries ${id}`);
  const cells = within(row).getAllByRole('cell');
  const last = cells[cells.length - 1];
  if (last === undefined) throw new Error('row has no cells');
  return last;
}

describe('what caused a movement', () => {
  it('says which KIND of record the id belongs to', () => {
    render(<MovementsIndex />);
    expect(causedBy(ORDER_ID).textContent).toBe(`order ${ORDER_ID}`);
    expect(causedBy(SHIPMENT_ID).textContent).toBe(`parcel ${SHIPMENT_ID}`);
    expect(causedBy(ADJUSTMENT_ID).textContent).toBe(`adjustment ${ADJUSTMENT_ID}`);
  });

  it('keeps the whole id, because the point of it is pasting it somewhere', () => {
    render(<MovementsIndex />);
    for (const id of [ORDER_ID, SHIPMENT_ID, ADJUSTMENT_ID]) {
      expect(causedBy(id).textContent).toContain(id);
    }
  });

  it('shows a dash where nothing upstream explains the row', () => {
    render(<MovementsIndex />);
    // By its CHANGE, not by its type: "receiving" is also an option in
    // the Type filter, so the plain text match is two elements.
    const row = screen.getByText('+22').closest('tr');
    if (row === null) throw new Error('no receiving row');
    const cells = within(row).getAllByRole('cell');
    expect(cells[cells.length - 1]?.textContent).toBe('—');
  });
});

/**
 * And the Type filter, which was a hand-kept list of thirteen against a
 * schema of fourteen — missing `PACK_REVERSED`, the give-back on a
 * packed parcel whose order was cancelled before any courier took it.
 * Of every kind to be unable to filter for, that is the one somebody
 * comes to this page looking for: "we cancelled it, did the stock come
 * back?" The rows showed; only the filter was short.
 */
describe('the type filter', () => {
  it('offers every kind of movement the schema can hold', () => {
    render(<MovementsIndex />);
    const options = within(screen.getByLabelText('Type')).getAllByRole('option');
    const offered = options.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== '');
    expect(offered).toEqual(Object.values(StockMovementType));
  });

  it('offers the give-back by name', () => {
    render(<MovementsIndex />);
    expect(
      within(screen.getByLabelText('Type')).getByRole('option', { name: 'pack reversed' }),
    ).toBeDefined();
  });
});
