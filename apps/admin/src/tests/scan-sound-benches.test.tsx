/**
 * EVERY BENCH ANSWERS OUT LOUD — the scan sounds, wired per station.
 *
 * `scan-sound.test.ts` covers the module itself (it never throws, and the
 * mute is ONE device-wide setting shared by every mounted bench). This
 * file covers the wiring: that each surface a scanner drives calls
 * `accepted()` when it took the scan and `refused()` on EVERY path where
 * the screen says no — including the refusals that only set an inline
 * message, which are exactly the ones a packer looking at the item in
 * their hands would otherwise miss.
 *
 * Half-wiring is the failure this guards against: once the floor trusts
 * the pair, a SILENT refusal reads as success and the wrong item goes in
 * the box. So the assertions are per-path, not per-bench.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';

/**
 * The real module is unmockable at the assertion level — `useScanSound`
 * hands back direct references to `playScanAccepted` / `playScanRefused`,
 * and in jsdom both are no-ops because there is no `AudioContext`. So the
 * hook is replaced by spies with the same shape, and the object is STABLE
 * across renders exactly as the real `useMemo`'d one is (a fresh identity
 * every render would make an effect that depends on it re-run forever).
 */
const sound = vi.hoisted(() => {
  const accepted = vi.fn();
  const refused = vi.fn();
  const prime = vi.fn();
  const toggleMute = vi.fn();
  return {
    accepted,
    refused,
    prime,
    toggleMute,
    api: { accepted, refused, prime, toggleMute, muted: false },
  };
});

vi.mock('@/lib/scan-sound', () => ({
  useScanSound: () => sound.api,
  playScanAccepted: sound.accepted,
  playScanRefused: sound.refused,
  primeScanSound: sound.prime,
}));

import { SerialScanner } from '@/components/ui/serial-scanner';
import { PickStation } from '@/app/(authed)/warehouse/pick/_components/pick-station';
import { ReceiveDetailView } from '@/app/(authed)/warehouse/receive/_components/receive-detail-view';
import { PrintingStation } from '@/app/(authed)/warehouse/printing/_components/printing-station';
import { ConsignmentPanel } from '@/app/(authed)/warehouse/consignments/[id]/_components/consignment-panel';
import { makeStaff, renderWithProviders } from './helpers';
import { scanFetch, type ScanRoute } from './scan-fetch';

beforeEach(() => {
  sound.accepted.mockClear();
  sound.refused.mockClear();
});

/** What a barcode gun does: types the code, then presses Enter itself. */
function scan(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

// ── the shared field: EVERY serial, not only the final outcome ─────────

function SerialHarness(): ReactElement {
  const [serials, setSerials] = useState<readonly string[]>([]);
  return (
    <SerialScanner
      id="serials"
      label="Unit serials"
      required={3}
      serials={serials}
      onChange={setSerials}
    />
  );
}

describe('SerialScanner — one sound per serial', () => {
  it('plays accepted on EVERY serial taken, not once at the end', () => {
    renderWithProviders(<SerialHarness />);
    const field = screen.getByLabelText('Unit serials') as HTMLInputElement;
    scan(field, 'SER-1');
    scan(field, 'SER-2');
    expect(sound.accepted).toHaveBeenCalledTimes(2);
    expect(sound.refused).not.toHaveBeenCalled();
  });

  it('plays refused on the serial it rejects itself (already in the list)', () => {
    renderWithProviders(<SerialHarness />);
    const field = screen.getByLabelText('Unit serials') as HTMLInputElement;
    scan(field, 'SER-1');
    scan(field, 'SER-1');
    // The notice is on screen AND in the room: a re-scan that only wrote
    // a line of small text reads as a second unit captured.
    expect(screen.getByText(/already in this list/i)).toBeInTheDocument();
    expect(sound.accepted).toHaveBeenCalledTimes(1);
    expect(sound.refused).toHaveBeenCalledTimes(1);
  });
});

// ── the pick bench ────────────────────────────────────────────────────

const PICK = {
  shipmentId: 'sh-1',
  shipmentNumber: 'SH-2026-000001',
  orderId: 'o-1',
  orderNumber: 'SD-2026-26-000001',
  pickStartedAt: '2026-09-20T10:00:00.000Z',
  pickExpiresAt: '2026-09-20T10:30:00.000Z',
  items: [
    {
      shipmentItemId: 'si-1',
      variantId: 'v-1',
      productName: 'Kurti',
      variantLabel: null,
      skuCode: 'SKU-A',
      quantity: 1,
      unitWeightGrams: null,
      inventoryMode: 'NORMAL',
    },
  ],
};

function pickRoutes(nextReply: ScanRoute['reply']): ScanRoute[] {
  return [
    { match: /\/api\/warehouse\/picks\/next$/, method: 'POST', reply: nextReply },
    {
      match: /\/api\/warehouse\/picks\/sh-1\/start$/,
      method: 'POST',
      reply: { status: 200, body: { status: 'PENDING_PICK', allocations: [] } },
    },
    {
      match: /\/api\/warehouse\/picks\/sh-1\/items$/,
      method: 'POST',
      reply: { status: 200, body: {} },
    },
  ];
}

describe('pick bench — refusals are audible', () => {
  it('plays refused when the pull comes back rejected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PickStation />, {
      fetchImpl: scanFetch(
        pickRoutes({
          status: 409,
          body: { code: 'PICK_NOT_OWNED', message: 'That pick is not yours.' },
        }),
      ),
    });
    await user.click(screen.getByRole('button', { name: 'Pull next' }));
    await screen.findByRole('alert');
    expect(sound.refused).toHaveBeenCalledTimes(1);
    expect(sound.accepted).not.toHaveBeenCalled();
  });

  it('plays accepted when the pick starts, and refused when Record is missing bin/batch', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PickStation />, {
      fetchImpl: scanFetch(pickRoutes({ status: 200, body: { pick: PICK } })),
    });
    await user.click(screen.getByRole('button', { name: 'Pull next' }));
    await user.click(await screen.findByRole('button', { name: 'Start pick' }));
    await waitFor(() => expect(sound.accepted).toHaveBeenCalledTimes(1));

    // Bin and batch empty: today this only wrote an inline line of red
    // text, which is the silent-refusal shape the owner's rule is about.
    await user.click(await screen.findByRole('button', { name: 'Record' }));
    await screen.findByRole('alert');
    expect(sound.refused).toHaveBeenCalledTimes(1);
  });
});

// ── the receive bench ─────────────────────────────────────────────────

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
  lines: [
    {
      id: 'l-1',
      variantId: 'v-1',
      batchId: null,
      expectedQty: 5,
      receivedQty: null,
      damagedQty: null,
      unitCostInr: null,
      manufacturedAt: null,
      expiresAt: null,
      putawayBinId: null,
      primaryImageUrl: null,
      variant: { skuCode: 'SKU-A', variantLabel: null, product: { name: 'Product SKU-A' } },
      batch: null,
      putawayBin: null,
      inventoryMode: 'NORMAL',
    },
  ],
};

const RECEIVE_ROUTES: ScanRoute[] = [
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
    reply: { status: 200, body: [] },
  },
];

describe('receive bench — refusals are audible', () => {
  it('plays refused on the "nothing to record" refusal, which is inline-only', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiveDetailView id="gr-1" />, { fetchImpl: scanFetch(RECEIVE_ROUTES) });
    await screen.findByText('Product SKU-A');
    await user.click(screen.getByRole('button', { name: 'Record all products' }));
    await waitFor(() => expect(sound.refused).toHaveBeenCalledTimes(1));
    expect(sound.accepted).not.toHaveBeenCalled();
  });

  it('plays accepted once the counts record', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiveDetailView id="gr-1" />, { fetchImpl: scanFetch(RECEIVE_ROUTES) });
    await screen.findByText('Product SKU-A');
    const [recv] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    if (recv === undefined) throw new Error('count field missing');
    await user.type(recv, '4');
    await user.click(screen.getByRole('button', { name: 'Record all products' }));
    await waitFor(() => expect(sound.accepted).toHaveBeenCalledTimes(1));
    expect(sound.refused).not.toHaveBeenCalled();
  });

  it('offers the ONE shared mute, not a second one', async () => {
    renderWithProviders(<ReceiveDetailView id="gr-1" />, { fetchImpl: scanFetch(RECEIVE_ROUTES) });
    await screen.findByText('Product SKU-A');
    expect(screen.getAllByRole('button', { name: /Sound on/ })).toHaveLength(1);
  });
});

// ── printing: the two fields a gun actually drives ────────────────────

function printingRoutes(batches: readonly unknown[]): ScanRoute[] {
  return [
    {
      match: /\/api\/admin\/warehouse\/printing\/pick-batches/,
      method: 'GET',
      reply: { status: 200, body: batches },
    },
  ];
}

const BATCH = {
  id: 'pb-1',
  batchNumber: 'PB-2026-09-0001',
  status: 'DRAFT',
  warehouseId: 'wh-1',
  warehouseName: 'Bangalore',
  shipmentCount: 1,
  createdAt: '2026-09-20T10:00:00.000Z',
  printedAt: null,
  pickedAt: null,
};

async function openBatches(batches: readonly unknown[]): Promise<HTMLInputElement> {
  const user = userEvent.setup();
  renderWithProviders(<PrintingStation />, { fetchImpl: scanFetch(printingRoutes(batches)) });
  await user.click(screen.getByRole('button', { name: 'Past batches' }));
  return screen.getByLabelText('Search batches') as HTMLInputElement;
}

describe('printing — a scanned search gets an answer', () => {
  it('plays refused when the scanned code matches nothing', async () => {
    const field = await openBatches([]);
    scan(field, 'SD-2026-26-000404');
    await waitFor(() => expect(sound.refused).toHaveBeenCalledTimes(1));
    expect(sound.accepted).not.toHaveBeenCalled();
  });

  it('plays accepted when it finds something', async () => {
    const field = await openBatches([BATCH]);
    scan(field, 'PB-2026-09-0001');
    await waitFor(() => expect(sound.accepted).toHaveBeenCalledTimes(1));
    expect(sound.refused).not.toHaveBeenCalled();
  });

  it('says nothing while the operator is still typing — only Enter commits', async () => {
    const field = await openBatches([]);
    fireEvent.change(field, { target: { value: 'PB-' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(sound.accepted).not.toHaveBeenCalled();
    expect(sound.refused).not.toHaveBeenCalled();
  });
});

// ── the consignment panel's one scan-fed path ─────────────────────────

const CONSIGNMENT = {
  id: 'cn-1',
  consignmentNumber: 'CN-2026-09-000001',
  sellerId: 'seller-1',
  route: 'DIRECT_IN',
  status: 'PENDING',
  labellingSite: 'IN',
  labelsPrintedAt: '2026-09-20T10:00:00.000Z',
  expectedArrivalAt: null,
  sellerReference: null,
  cancelledAt: null,
  cancelReason: null,
  inboundFreightMode: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  seller: { id: 'seller-1', companyName: 'Menev Store', emailDisplay: 'menev@example.com' },
  receipts: [],
  freightCharges: [],
};

const REPRINT = /\/api\/admin\/consignments\/cn-1\/labels\/reprint-requests$/;

function consignmentRoutes(post: ScanRoute['reply']): ScanRoute[] {
  return [
    { match: REPRINT, method: 'POST', reply: post },
    { match: REPRINT, method: 'GET', reply: { status: 200, body: [] } },
    {
      match: /\/api\/admin\/consignments\/cn-1\/events$/,
      method: 'GET',
      reply: { status: 200, body: [] },
    },
    {
      match: /\/api\/admin\/consignments\/cn-1\/labels$/,
      method: 'GET',
      reply: { status: 200, body: { strictUnits: 0, strictSkus: 0 } },
    },
    {
      match: /\/api\/admin\/consignments\/cn-1$/,
      method: 'GET',
      reply: { status: 200, body: CONSIGNMENT },
    },
  ];
}

describe('consignment — the scanned damaged serials', () => {
  it('plays refused when the server rejects the scanned serials', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConsignmentPanel id="cn-1" />, {
      identity: makeStaff(undefined, ['inventory.goods_receipts.manage']),
      fetchImpl: scanFetch(
        consignmentRoutes({
          status: 409,
          body: {
            code: 'REPRINT_ALREADY_REQUESTED',
            message: 'SER-1 is already on an open request.',
          },
        }),
      ),
    });
    await user.click(await screen.findByRole('button', { name: 'A label was damaged or lost' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Serials to reprint' }), {
      target: { value: 'SER-1' },
    });
    await user.type(screen.getByRole('textbox', { name: 'Why' }), 'Label torn in transit');
    await user.click(screen.getByRole('button', { name: 'Ask for approval' }));
    await waitFor(() => expect(sound.refused).toHaveBeenCalledTimes(1));
    expect(sound.accepted).not.toHaveBeenCalled();
  });
});
