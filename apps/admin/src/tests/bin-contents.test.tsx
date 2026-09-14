import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { BinContentsOverview } from '../app/(authed)/warehouse/bins/_components/bin-contents-overview';
import { BinsIndex } from '../app/(authed)/warehouse/bins/_components/bins-index';
import { BinDetail } from '../app/(authed)/warehouse/bins/[binId]/_components/bin-detail';
import { MovementsIndex } from '../app/(authed)/inventory/movements/_components/movements-index';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

/**
 * "Where can I see what R-01-01 and D-01-01 hold?" — and, from the owner's
 * follow-up, every bin with its products and sellers on one screen.
 */

const staff = makeStaff('SUPER_ADMIN' as never, ['warehouse.view', 'inventory.view']);

const kurta = {
  stockLevelId: 'sl-1',
  sellerId: 's-menev',
  sellerName: 'Menev Store',
  variantId: 'v-kurta',
  productName: 'Cotton Kurta',
  thumbnailUrl: 'https://spaces.example/thumb-kurta.webp',
  skuCode: 'KRT-RED-L',
  variantLabel: 'Red / L',
  batchId: 'bt-1',
  batchCode: 'B-2026-08',
  batchExpiresAt: '2027-03-01T00:00:00.000Z',
  qtyOnHand: 300,
  qtyReserved: 4,
};
const saree = {
  ...kurta,
  stockLevelId: 'sl-2',
  sellerId: 's-rupa',
  sellerName: 'Rupa Textiles',
  variantId: 'v-saree',
  productName: 'Silk Saree',
  thumbnailUrl: null,
  skuCode: 'SAR-GRN',
  variantLabel: null,
  batchCode: 'B-2026-09',
  batchExpiresAt: null,
  qtyOnHand: 7,
  qtyReserved: 0,
};

const bin = (over: Record<string, unknown>) => ({
  id: 'b-floor',
  code: 'FLOOR',
  type: 'STORAGE',
  zoneCode: 'MAIN',
  pickable: true,
  unitsOnHand: 0,
  unitsReserved: 0,
  skuCount: 0,
  lineCount: 0,
  lines: [],
  linesNotShown: 0,
  ...over,
});

const overview = {
  linesPerBin: 50,
  warehouses: [
    {
      id: 'w-ccu',
      code: 'CCU-01',
      name: 'Kolkata Main',
      binTrackingEnabled: false,
      fulfilsOrders: true,
      bins: [
        bin({ id: 'b-dmg', code: 'D-01-01', type: 'DAMAGED', pickable: false }),
        bin({
          unitsOnHand: 307,
          unitsReserved: 4,
          skuCount: 2,
          lineCount: 3,
          lines: [kurta, saree],
          linesNotShown: 1,
        }),
        bin({ id: 'b-rto', code: 'R-01-01', type: 'RTO_HOLD', pickable: false }),
        bin({ id: 'b-tr', code: 'TRANSIT', type: 'TRANSIT', pickable: false }),
      ],
    },
  ],
};

const overviewRoute = (times = 3) => ({
  match: /\/api\/admin\/bin-contents(\?|$)/,
  responses: Array.from({ length: times }, () => ({ status: 200, body: overview })),
});

describe('every bin, with what is in it', () => {
  it('shows each bin with its products, SKUs, sellers and batches — empty bins too', async () => {
    renderWithProviders(<BinContentsOverview />, {
      identity: staff,
      fetchImpl: buildFetchMock([overviewRoute()]),
    });

    await screen.findByText('Cotton Kurta');
    expect(screen.getByText('KRT-RED-L')).toBeTruthy();
    // The seller's company name is on the line itself (it is also an
    // option in the Seller filter, hence the cell check).
    const inCell = (name: string): boolean =>
      screen.getAllByText(name).some((el) => el.closest('td') !== null);
    expect(inCell('Menev Store')).toBe(true);
    expect(inCell('Rupa Textiles')).toBe(true);
    expect(screen.getByText('B-2026-08')).toBeTruthy();
    expect(screen.getByText(/expires/)).toBeTruthy();
    // The product picture sits beside the line.
    const thumb = screen.getByAltText('Cotton Kurta');
    expect(thumb.getAttribute('src')).toBe('https://spaces.example/thumb-kurta.webp');

    // Totals in the bin header, reserved included.
    const floorTotal = screen.getByTestId('bin-total-FLOOR').textContent ?? '';
    expect(floorTotal).toMatch(/307/);
    expect(floorTotal).toMatch(/2 SKUs/);
    expect(floorTotal).toMatch(/4.*reserved/);

    // The empty ones still appear, and say so.
    expect(screen.getByTestId('bin-total-R-01-01').textContent).toBe('Empty');
    expect(screen.getByTestId('bin-total-D-01-01').textContent).toBe('Empty');
  });

  it('says plainly that returns-hold, damaged and transit stock cannot be sold', async () => {
    renderWithProviders(<BinContentsOverview />, {
      identity: staff,
      fetchImpl: buildFetchMock([overviewRoute()]),
    });
    await screen.findByText('Cotton Kurta');
    // WMS-8e: the returns hold holds what came back and is not decided yet.
    expect(screen.getByText(/Returns received but not yet decided/)).toBeTruthy();
    const putaway = screen.getByRole('link', { name: /decide them at the RTO station/ });
    expect(putaway.getAttribute('href')).toBe('/warehouse/rto?tab=bench');
    expect(screen.getByText(/Held back from sale\. Nothing is picked/)).toBeTruthy();
    expect(screen.getByText(/On its way from another warehouse/)).toBeTruthy();
  });

  it('links a capped bin to its own page, naming how many lines are not shown', async () => {
    renderWithProviders(<BinContentsOverview />, {
      identity: staff,
      fetchImpl: buildFetchMock([overviewRoute()]),
    });
    const more = await screen.findByRole('link', { name: /1 more line — open FLOOR/ });
    expect(more.getAttribute('href')).toBe('/warehouse/bins/b-floor');
  });

  it('filters by seller and by SKU without another request', async () => {
    const fetchImpl = buildFetchMock([overviewRoute()]);
    renderWithProviders(<BinContentsOverview />, { identity: staff, fetchImpl });
    await screen.findByText('Cotton Kurta');
    const calls = fetchImpl.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Seller'), { target: { value: 's-rupa' } });
    expect(screen.queryByText('Cotton Kurta')).toBeNull();
    expect(screen.getByText('Silk Saree')).toBeTruthy();
    // A line filter hides bins with nothing matching.
    expect(screen.queryByTestId('bin-total-R-01-01')).toBeNull();

    fireEvent.change(screen.getByLabelText('Seller'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Product, SKU or batch'), {
      target: { value: 'krt-red' },
    });
    expect(screen.getByText('Cotton Kurta')).toBeTruthy();
    expect(screen.queryByText('Silk Saree')).toBeNull();

    expect(fetchImpl.mock.calls.length).toBe(calls);
  });

  it('filters by bin type', async () => {
    renderWithProviders(<BinContentsOverview />, {
      identity: staff,
      fetchImpl: buildFetchMock([overviewRoute()]),
    });
    await screen.findByText('Cotton Kurta');
    fireEvent.change(screen.getByLabelText('Bin type'), { target: { value: 'RTO_HOLD' } });
    expect(screen.getByTestId('bin-total-R-01-01')).toBeTruthy();
    expect(screen.queryByTestId('bin-total-FLOOR')).toBeNull();
  });
});

describe('the layout table carries the totals', () => {
  it('adds units and SKUs per bin, and links each code to the bin', async () => {
    const layoutBins = [
      {
        id: 'b-floor',
        code: 'FLOOR',
        type: 'STORAGE',
        zoneId: 'z1',
        aisle: null,
        rack: null,
        shelf: null,
      },
      {
        id: 'b-rto',
        code: 'R-01-01',
        type: 'RTO_HOLD',
        zoneId: 'z1',
        aisle: 'R',
        rack: '01',
        shelf: '01',
      },
    ];
    const fetchImpl = buildFetchMock([
      overviewRoute(),
      {
        match: /\/api\/admin\/warehouses(\?|$)/,
        responses: Array.from({ length: 3 }, () => ({
          status: 200,
          body: [
            {
              id: 'w-ccu',
              code: 'CCU-01',
              name: 'Kolkata Main',
              status: 'ACTIVE',
              countryCode: 'IN',
              timezone: 'Asia/Kolkata',
              binTrackingEnabled: false,
              fulfilsOrders: true,
            },
          ],
        })),
      },
      {
        match: /\/api\/admin\/warehouses\/w-ccu\/bins(\?|$)/,
        responses: Array.from({ length: 3 }, () => ({ status: 200, body: layoutBins })),
      },
      {
        match: /\/api\/admin\/warehouses\/w-ccu\/zones(\?|$)/,
        responses: Array.from({ length: 3 }, () => ({
          status: 200,
          body: [
            {
              id: 'z1',
              warehouseId: 'w-ccu',
              code: 'MAIN',
              name: 'Main',
              pickOrder: 1,
              isActive: true,
            },
          ],
        })),
      },
    ]);
    renderWithProviders(<BinsIndex />, { identity: staff, fetchImpl });

    const total = await screen.findByTestId('layout-total-FLOOR');
    expect(total.textContent).toMatch(/307/);
    expect(total.textContent).toMatch(/2 SKUs/);
    const row = total.closest('tr');
    expect(row).not.toBeNull();
    const code = within(row as HTMLElement).getByRole('link', { name: 'FLOOR' });
    expect(code.getAttribute('href')).toBe('/warehouse/bins/b-floor');

    await waitFor(() => {
      const rto = screen.getAllByText('R-01-01').find((el) => el.closest('tr') !== null);
      expect(rto?.closest('tr')?.textContent).toMatch(/Empty/);
    });
  });
});

describe('one bin, all of it', () => {
  const page = {
    bin: {
      id: 'b-floor',
      code: 'FLOOR',
      type: 'STORAGE',
      zoneCode: 'MAIN',
      pickable: true,
      unitsOnHand: 307,
      unitsReserved: 4,
      skuCount: 2,
      lineCount: 2,
      warehouseId: 'w-ccu',
      warehouseCode: 'CCU-01',
      warehouseName: 'Kolkata Main',
    },
    items: [{ ...kurta, lastMovementAt: '2026-09-10T08:00:00.000Z' }],
    total: 2,
    page: 1,
    pageSize: 50,
  };

  it('lists its lines with when each last moved, and links to its movements', async () => {
    renderWithProviders(<BinDetail binId="b-floor" />, {
      identity: staff,
      fetchImpl: buildFetchMock([
        { match: /\/api\/admin\/bin-contents\/b-floor/, responses: [{ status: 200, body: page }] },
      ]),
    });
    await screen.findByText('Cotton Kurta');
    expect(screen.getByText('Bin FLOOR')).toBeTruthy();
    expect(screen.getByText('Menev Store')).toBeTruthy();
    expect(
      screen.getByText(new Date('2026-09-10T08:00:00.000Z').toLocaleString('en-IN')),
    ).toBeTruthy();
    const mv = screen.getByRole('link', { name: 'Movements for this bin' });
    expect(mv.getAttribute('href')).toBe('/inventory/movements?warehouse=w-ccu&bin=b-floor');
  });

  it('hides the movements link from someone who cannot read the ledger', async () => {
    renderWithProviders(<BinDetail binId="b-floor" />, {
      identity: makeStaff('SUPER_ADMIN' as never, ['warehouse.view']),
      fetchImpl: buildFetchMock([
        { match: /\/api\/admin\/bin-contents\/b-floor/, responses: [{ status: 200, body: page }] },
      ]),
    });
    await screen.findByText('Cotton Kurta');
    expect(screen.queryByRole('link', { name: 'Movements for this bin' })).toBeNull();
  });

  it('says an empty bin is empty', async () => {
    renderWithProviders(<BinDetail binId="b-rto" />, {
      identity: staff,
      fetchImpl: buildFetchMock([
        {
          match: /\/api\/admin\/bin-contents\/b-rto/,
          responses: [
            {
              status: 200,
              body: {
                ...page,
                bin: {
                  ...page.bin,
                  id: 'b-rto',
                  code: 'R-01-01',
                  type: 'RTO_HOLD',
                  unitsOnHand: 0,
                  unitsReserved: 0,
                  skuCount: 0,
                  lineCount: 0,
                },
                items: [],
                total: 0,
              },
            },
          ],
        },
      ]),
    });
    expect(await screen.findByText('This bin is empty')).toBeTruthy();
  });
});

describe('movements, readable by bin', () => {
  const movement = {
    id: 'm1',
    createdAt: '2026-09-10T08:00:00.000Z',
    sellerId: 's-menev',
    variantId: 'v-kurta',
    warehouseId: 'w-ccu',
    warehouseCode: 'CCU-01',
    binId: 'b-rto',
    binCode: 'R-01-01',
    batchId: 'bt-1',
    type: 'RETURN_RESTOCK',
    qtyChange: 1,
    qtyAfter: 1,
    reasonCode: null,
    orderId: null,
    shipmentId: null,
    adjustmentId: null,
    performedByStaffId: null,
  };

  it('shows the bin code and warehouse, and filters by the bin from the URL', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/stock-movements/,
        responses: Array.from({ length: 3 }, () => ({
          status: 200,
          body: { items: [movement], total: 1, page: 1, pageSize: 50 },
        })),
      },
      {
        match: /\/api\/admin\/warehouses\/w-ccu\/bins(\?|$)/,
        responses: Array.from({ length: 3 }, () => ({
          status: 200,
          body: [{ id: 'b-rto', code: 'R-01-01', type: 'RTO_HOLD' }],
        })),
      },
      {
        match: /\/api\/admin\/warehouses(\?|$)/,
        responses: Array.from({ length: 3 }, () => ({
          status: 200,
          body: [{ id: 'w-ccu', code: 'CCU-01', name: 'Kolkata Main' }],
        })),
      },
    ]);
    renderWithProviders(<MovementsIndex initialWarehouseId="w-ccu" initialBinId="b-rto" />, {
      identity: staff,
      fetchImpl,
    });

    await screen.findByText('· CCU-01');
    const cell = screen.getByText('· CCU-01').closest('td');
    expect(cell?.textContent).toBe('R-01-01 · CCU-01');

    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    const ledger = urls.find((u) => u.includes('/api/admin/stock-movements'));
    expect(ledger).toContain('binId=b-rto');
    expect(ledger).toContain('warehouseId=w-ccu');

    const binSelect = screen.getByLabelText('Bin') as HTMLSelectElement;
    await waitFor(() => expect(binSelect.value).toBe('b-rto'));
  });
});
