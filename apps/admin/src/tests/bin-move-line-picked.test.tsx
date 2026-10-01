import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { BinOpsPanel } from '../app/(authed)/warehouse/bins/_components/bin-ops-panel';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

/**
 * "Apply a list of moves" asks WHICH LINE, by name.
 *
 * It used to ask for a seller id, a variant id and a batch id — three
 * uuids, in three monospace boxes, and no screen in the admin app
 * offered any of them to copy. The advanced half of the re-shelving
 * form was therefore unusable from the console: the same "a row named
 * by its uuid" defect the rest of the estate has been fixed of, in its
 * INPUT form.
 *
 * What is pinned: no id is typed anywhere, the choice is driven by the
 * line's own FROM bin (because a line can only move out of the bin it
 * is in), the three ids travel to the server together and consistent
 * with one another, and changing the FROM bin CLEARS the chosen line
 * rather than carrying a row of another bin's stock across.
 */

const staff = makeStaff('SUPER_ADMIN' as never, ['warehouse.view', 'warehouse.manage']);

const BINS = [
  { id: 'b-floor', code: 'FLOOR', type: 'STORAGE' },
  { id: 'b-a0101', code: 'A-01-01', type: 'STORAGE' },
];

const kurta = {
  stockLevelId: 'sl-kurta',
  sellerId: 's-menev',
  sellerName: 'Menev Store',
  variantId: 'v-kurta',
  productName: 'Cotton Kurta',
  thumbnailUrl: null,
  skuCode: 'KRT-RED-L',
  variantLabel: 'Red / L',
  batchId: 'bt-aug',
  batchCode: 'B-2026-08',
  batchExpiresAt: null,
  qtyOnHand: 300,
  qtyReserved: 0,
  lastMovementAt: null,
};
const saree = {
  ...kurta,
  stockLevelId: 'sl-saree',
  sellerId: 's-rupa',
  variantId: 'v-saree',
  productName: 'Silk Saree',
  skuCode: 'SAR-GRN',
  variantLabel: null,
  batchId: 'bt-sep',
  batchCode: 'B-2026-09',
  qtyOnHand: 7,
};

function contentsPage(items: readonly unknown[], total = items.length): unknown {
  return {
    bin: {
      id: 'b-floor',
      code: 'FLOOR',
      type: 'STORAGE',
      zoneCode: 'MAIN',
      pickable: true,
      unitsOnHand: 0,
      unitsReserved: 0,
      skuCount: 0,
      lineCount: 0,
      warehouseId: 'w-1',
      warehouseCode: 'CCU-01',
      warehouseName: 'Kolkata',
    },
    items,
    total,
    page: 1,
    pageSize: 200,
  };
}

function mount(opts: { readonly floor?: unknown; readonly rack?: unknown } = {}) {
  const fetchImpl = buildFetchMock([
    { match: /\/api\/admin\/warehouses\/w-1\/bins/, responses: [{ status: 200, body: BINS }] },
    {
      match: /\/api\/admin\/bin-contents\/b-floor/,
      responses: [{ status: 200, body: opts.floor ?? contentsPage([kurta, saree]) }],
    },
    {
      match: /\/api\/admin\/bin-contents\/b-a0101/,
      responses: [{ status: 200, body: opts.rack ?? contentsPage([]) }],
    },
    {
      match: /\/api\/admin\/warehouses\/w-1\/bin-ops\/bulk-transfer/,
      responses: [{ status: 200, body: { unitsMoved: 12, linesMoved: 1 } }],
    },
  ]);
  return renderWithProviders(<BinOpsPanel warehouseId="w-1" />, { identity: staff, fetchImpl });
}

/*
 * Every control the line list owns is reachable from `screen` without
 * scoping: the whole-bin panel above labels its selects "From" and "To"
 * (testing-library's getByLabelText is EXACT by default, so they do not
 * collide with "From bin" / "To bin"), and only this panel has a Product
 * or a Quantity at all.
 */

/**
 * The bins list is a query of its own, and selecting an option that has
 * not arrived yet is a silent no-op in jsdom — the select keeps its old
 * value and the test fails somewhere else entirely.
 */
async function binsLoaded(): Promise<void> {
  await screen.findByText('Apply a list of moves');
  // Several selects on this page offer the same bins — the whole-bin
  // panel's two and the line's two — so it is "all", not "a".
  await screen.findAllByRole('option', { name: 'FLOOR' });
}

describe('bulk bin moves — the line is picked, never typed', () => {
  it('offers no id field at all', async () => {
    mount();
    await screen.findByText('Apply a list of moves');
    // The three boxes this replaced. Their absence IS the fix.
    expect(screen.queryByLabelText('Seller id')).toBeNull();
    expect(screen.queryByLabelText('Variant id')).toBeNull();
    expect(screen.queryByLabelText('Batch id')).toBeNull();
  });

  it('will not ask which product until a From bin names a list to choose from', async () => {
    mount();
    await screen.findByText('Apply a list of moves');
    const product = screen.getByLabelText('Product');
    expect(product).toBeDisabled();
    expect(product).toHaveTextContent('choose a From bin first');
  });

  it('lists that bin’s own stock by SKU, product and batch once From is chosen', async () => {
    mount();
    await binsLoaded();
    fireEvent.change(screen.getByLabelText('From bin'), { target: { value: 'b-floor' } });

    const product = screen.getByLabelText('Product');
    await waitFor(() => expect(product).not.toBeDisabled());
    expect(product).toHaveTextContent(
      'KRT-RED-L — Cotton Kurta (Red / L) · batch B-2026-08 · 300 on hand',
    );
    expect(product).toHaveTextContent('SAR-GRN — Silk Saree · batch B-2026-09 · 7 on hand');
  });

  it('sends the three ids of the line that was chosen, together', async () => {
    const { fetchImpl } = mount();
    await binsLoaded();
    fireEvent.change(screen.getByLabelText('From bin'), { target: { value: 'b-floor' } });
    await waitFor(() => expect(screen.getByLabelText('Product')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'sl-saree' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('To bin'), { target: { value: 'b-a0101' } });

    fireEvent.click(screen.getByRole('button', { name: /Apply 1 line/i }));

    await waitFor(() => {
      const call = fetchImpl.mock.calls.find((c: readonly unknown[]) =>
        String(c[0]).includes('bulk-transfer'),
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as { body?: unknown })?.body ?? '{}'));
      expect(body.lines).toEqual([
        {
          sellerId: 's-rupa',
          variantId: 'v-saree',
          batchId: 'bt-sep',
          qty: 7,
          sourceBinId: 'b-floor',
          destBinId: 'b-a0101',
        },
      ]);
    });
  });

  it('clears the chosen line when the From bin changes — it belonged to the old bin', async () => {
    mount();
    await binsLoaded();
    fireEvent.change(screen.getByLabelText('From bin'), { target: { value: 'b-floor' } });
    await waitFor(() => expect(screen.getByLabelText('Product')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'sl-kurta' } });
    expect(screen.getByLabelText('Product')).toHaveValue('sl-kurta');

    fireEvent.change(screen.getByLabelText('From bin'), { target: { value: 'b-a0101' } });
    await waitFor(() => expect(screen.getByLabelText('Product')).toHaveValue(''));
    // That bin is empty, so there is nothing to carry over TO either —
    // waited for, because the new bin's contents are a fresh request.
    await waitFor(() =>
      expect(screen.getByLabelText('Product')).toHaveTextContent('this bin is empty'),
    );
  });

  it('says when a bin holds more lines than the dropdown can show', async () => {
    mount({ floor: contentsPage([kurta, saree], 412) });
    await binsLoaded();
    fireEvent.change(screen.getByLabelText('From bin'), { target: { value: 'b-floor' } });
    // "it is not in the list" and "the list stopped" are different
    // problems, and only one of them has an answer on this screen.
    expect(await screen.findByText(/Showing the first 2 of 412/)).toBeInTheDocument();
  });
});
