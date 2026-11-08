/**
 * "Nobody counted" is not "counted zero" (2026-11-08 production bug).
 *
 * Typed quantities live in component state until "Record all products"
 * writes them, and `received_qty` defaults to 0, so Complete used to throw
 * the typed numbers away and bank zeros. These pin the three halves of the
 * fix on the receive bench: an uncounted line is EMPTY and marked, a
 * recorded zero is still a 0, and Complete saves what is typed first.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiveDetailView } from '@/app/(authed)/warehouse/receive/_components/receive-detail-view';
import { renderWithProviders } from './helpers';
import { scanFetch, writesSeen, type ScanRoute } from './scan-fetch';

function line(id: string, skuCode: string, countedAt: string | null): Record<string, unknown> {
  return {
    id,
    variantId: `v-${id}`,
    batchId: null,
    expectedQty: 10,
    receivedQty: 0, // the column default: identical for "uncounted" and "counted zero"
    damagedQty: 0,
    countedAt,
    unitCostInr: null,
    manufacturedAt: null,
    expiresAt: null,
    putawayBinId: null,
    primaryImageUrl: null,
    variant: { skuCode, variantLabel: null, product: { name: `Product ${skuCode}` } },
    batch: null,
    putawayBin: null,
    inventoryMode: 'NORMAL',
  };
}

const RECEIPT = {
  id: 'gr-1',
  receiptNumber: 'GR-2026-11-0001',
  status: 'ARRIVING',
  sellerId: 'seller-1',
  warehouseId: 'wh-1',
  expectedArrivalAt: null,
  sellerReference: null,
  receivedAt: null,
  receivedById: 'staff-1',
  hasDiscrepancies: false,
  discrepancyNotes: null,
  createdAt: '2026-11-08T10:00:00.000Z',
  updatedAt: '2026-11-08T10:00:00.000Z',
  consignment: null,
  seller: { id: 'seller-1', companyName: 'Menev Store', email: 'menev@example.com' },
  warehouse: { id: 'wh-1', code: 'BLR', name: 'Bangalore' },
  receivedBy: { id: 'staff-1', email: 'ops@example.com', emailDisplay: 'ops@example.com' },
  lines: [line('l-1', 'SKU-A', null), line('l-2', 'SKU-B', '2026-11-08T10:05:00.000Z')],
};

function routes(linesReply: { status: number; body?: unknown }): ScanRoute[] {
  return [
    { match: /\/goods-receipts\/gr-1\/lines$/, method: 'POST', reply: linesReply },
    {
      match: /\/goods-receipts\/gr-1\/complete$/,
      method: 'POST',
      reply: { status: 201, body: RECEIPT },
    },
    { match: /\/goods-receipts\/gr-1$/, method: 'GET', reply: { status: 200, body: RECEIPT } },
    { match: /\/warehouses\/wh-1\/bins$/, method: 'GET', reply: { status: 200, body: [] } },
  ];
}

async function renderReceipt(linesReply = { status: 201, body: RECEIPT as unknown }) {
  const r = renderWithProviders(<ReceiveDetailView id="gr-1" />, {
    fetchImpl: scanFetch(routes(linesReply)),
  });
  await screen.findByText('Product SKU-A');
  return r;
}

function receivedBoxes(): HTMLInputElement[] {
  // [recv l-1, dmg l-1, recv l-2, dmg l-2]
  return screen.getAllByRole('spinbutton') as HTMLInputElement[];
}

describe('receive bench — uncounted vs counted zero', () => {
  it('an uncounted line renders an EMPTY box and is marked; a recorded zero shows 0', async () => {
    await renderReceipt();
    const boxes = receivedBoxes();
    expect(boxes[0]?.value).toBe('');
    expect(boxes[2]?.value).toBe('0');
    expect(screen.getAllByText('Not counted')).toHaveLength(1);
    expect(screen.getByTestId('uncounted-notice').textContent).toContain('SKU-A');
    expect(screen.getByTestId('uncounted-notice').textContent).not.toContain('SKU-B');
  });

  it('Complete with typed, unsaved input records it first and does not discard it', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await renderReceipt();
    const first = receivedBoxes()[0];
    if (first === undefined) throw new Error('received box missing');
    await user.type(first, '4');

    await user.click(screen.getByRole('button', { name: 'Save counts & complete' }));

    await waitFor(() =>
      expect(writesSeen(fetchImpl)).toEqual([
        {
          url: '/api/admin/goods-receipts/gr-1/lines',
          method: 'POST',
          body: { lines: [{ lineId: 'l-1', receivedQty: 4, damagedQty: 0 }] },
        },
      ]),
    );
    // The confirm opens only AFTER the save; nothing was completed yet.
    expect(await screen.findByText(/Complete and write stock/i)).toBeInTheDocument();
    expect(writesSeen(fetchImpl).some((w) => w.url.endsWith('/complete'))).toBe(false);
  });

  it('if saving fails, Complete stops: no confirm, no complete call, the typed number stays', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await renderReceipt({
      status: 422,
      body: { code: 'BIN_REQUIRED', message: 'Choose the bin' },
    });
    const first = receivedBoxes()[0];
    if (first === undefined) throw new Error('received box missing');
    await user.type(first, '4');
    await user.click(screen.getByRole('button', { name: 'Save counts & complete' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(/Complete and write stock/i)).toBeNull();
    expect(writesSeen(fetchImpl).some((w) => w.url.endsWith('/complete'))).toBe(false);
    expect(receivedBoxes()[0]?.value).toBe('4');
  });
});
