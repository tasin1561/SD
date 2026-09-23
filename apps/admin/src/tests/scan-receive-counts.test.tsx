/**
 * The receive station's count fields — `(authed)/warehouse/receive/_components/receive-detail-view.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. The Received and
 * Damaged fields are numeric inputs (so a phone shows a number pad), Enter
 * in them submits NOTHING (a count is recorded by "Record all products",
 * never by a stray Enter from a scan gun), the record button sends exactly
 * the typed values, and a STRICT line carries the SerialScanner. A restyle
 * must not change any of it.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiveDetailView } from '@/app/(authed)/warehouse/receive/_components/receive-detail-view';
import { renderWithProviders } from './helpers';
import { scanFetch, writesSeen, type ScanRoute } from './scan-fetch';

function line(
  id: string,
  skuCode: string,
  inventoryMode: 'NORMAL' | 'STRICT',
): Record<string, unknown> {
  return {
    id,
    variantId: `v-${id}`,
    batchId: null,
    expectedQty: 5,
    receivedQty: null,
    damagedQty: null,
    unitCostInr: null,
    manufacturedAt: null,
    expiresAt: null,
    putawayBinId: null,
    primaryImageUrl: null,
    variant: { skuCode, variantLabel: null, product: { name: `Product ${skuCode}` } },
    batch: null,
    putawayBin: null,
    inventoryMode,
  };
}

const RECEIPT = {
  id: 'gr-1',
  receiptNumber: 'GR-2026-09-0001',
  status: 'ARRIVING',
  sellerId: 'seller-1',
  warehouseId: 'wh-1',
  expectedArrivalAt: null,
  sellerReference: null,
  receivedAt: null,
  receivedById: 'staff-1',
  hasDiscrepancies: false,
  discrepancyNotes: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  consignment: null,
  seller: { id: 'seller-1', companyName: 'Menev Store', email: 'menev@example.com' },
  warehouse: { id: 'wh-1', code: 'BLR', name: 'Bangalore' },
  receivedBy: { id: 'staff-1', email: 'ops@example.com', emailDisplay: 'ops@example.com' },
  lines: [line('l-1', 'SKU-A', 'NORMAL'), line('l-2', 'SKU-S', 'STRICT')],
};

const BINS = [
  {
    id: 'bin-1',
    code: 'A-01-01',
    type: 'STORAGE',
    zoneId: 'z-1',
    aisle: 'A',
    rack: '01',
    shelf: '01',
  },
];

const ROUTES: ScanRoute[] = [
  {
    match: /\/api\/admin\/goods-receipts\/gr-1\/lines$/,
    method: 'POST',
    reply: { status: 201, body: RECEIPT },
  },
  {
    match: /\/api\/admin\/goods-receipts\/gr-1$/,
    method: 'GET',
    reply: { status: 200, body: RECEIPT },
  },
  {
    match: /\/api\/admin\/warehouses\/wh-1\/bins$/,
    method: 'GET',
    reply: { status: 200, body: BINS },
  },
];

async function renderReceipt(): Promise<ReturnType<typeof renderWithProviders>> {
  const r = renderWithProviders(<ReceiveDetailView id="gr-1" />, { fetchImpl: scanFetch(ROUTES) });
  await screen.findByText('Product SKU-A');
  // Wait for the bins so the putaway selects have their option.
  await screen.findAllByRole('option', { name: 'A-01-01 (STORAGE)' });
  return r;
}

/** Received and Damaged, per line, in DOM order: [recv l-1, dmg l-1, recv l-2, dmg l-2]. */
function countFields(): HTMLInputElement[] {
  return screen.getAllByRole('spinbutton') as HTMLInputElement[];
}

describe('receive station — count fields', () => {
  // receive-detail-view.tsx:475-493 — numeric inputs, as the source declares them.
  it('Received and Damaged are type=number, min=0, inputMode=numeric', async () => {
    await renderReceipt();
    const fields = countFields();
    expect(fields).toHaveLength(4);
    const [recv, dmg] = fields;
    for (const f of [recv, dmg]) {
      expect(f?.getAttribute('type')).toBe('number');
      expect(f?.getAttribute('min')).toBe('0');
      expect(f?.getAttribute('inputmode')).toBe('numeric');
    }
    // Received also caps at a million; Damaged carries no max.
    expect(recv?.getAttribute('max')).toBe('1000000');
    expect(dmg?.hasAttribute('max')).toBe(false);
  });

  // No onKeyDown on either field — Enter records nothing.
  it('Enter in the Received or Damaged field makes no request', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await renderReceipt();
    const [recv, dmg] = countFields();
    if (recv === undefined || dmg === undefined) throw new Error('count fields missing');
    await user.type(recv, '4{Enter}');
    await user.type(dmg, '{Enter}');
    await new Promise((r) => setTimeout(r, 50));
    expect(writesSeen(fetchImpl)).toEqual([]);
  });

  // :135-174 — "Record all products" POSTs /lines with the typed values;
  // a line with nothing typed in Received is left out.
  it('"Record all products" POSTs /lines with exactly the typed values', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await renderReceipt();
    const [recv, dmg] = countFields();
    if (recv === undefined || dmg === undefined) throw new Error('count fields missing');
    await user.type(recv, '4');
    await user.clear(dmg);
    await user.type(dmg, '1');
    const selects = screen
      .getAllByRole('combobox')
      .filter((s) => s.querySelector('option[value="bin-1"]') !== null);
    const firstBin = selects[0];
    if (firstBin === undefined) throw new Error('putaway select missing');
    fireEvent.change(firstBin, { target: { value: 'bin-1' } });

    await user.click(screen.getByRole('button', { name: 'Record all products' }));
    await waitFor(() =>
      expect(writesSeen(fetchImpl)).toEqual([
        {
          url: '/api/admin/goods-receipts/gr-1/lines',
          method: 'POST',
          body: {
            lines: [{ lineId: 'l-1', receivedQty: 4, damagedQty: 1, putawayBinId: 'bin-1' }],
          },
        },
      ]),
    );
  });

  // :530-541 — a STRICT line renders the SerialScanner; a NORMAL line does not.
  it('renders the SerialScanner on STRICT lines only', async () => {
    await renderReceipt();
    expect(document.getElementById('receipt-serials-l-2')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Supplier serials for SKU-S')).toBeInTheDocument();
    expect(document.getElementById('receipt-serials-l-1')).toBeNull();
  });
});
