'use client';

import type { ReactElement } from 'react';
import { ReceiveDetailView } from '../../../(authed)/warehouse/receive/_components/receive-detail-view';
import '../../../(authed)/warehouse/_components/benches.css';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/receive — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). One goods
 * receipt with real-looking lines, for the counting screen.
 *
 *   ?fixture=a  four lines being counted, long names, one counted by serial
 *            b  the receipt cannot be loaded
 */
const FIXTURES = ['a', 'b'] as const;
type F = (typeof FIXTURES)[number];

function line(n: number): Record<string, unknown> {
  const long = n === 2;
  return {
    id: `l-${n}`,
    variantId: `v-${n}`,
    batchId: null,
    expectedQty: n * 25,
    receivedQty: n === 1 ? 25 : null,
    damagedQty: n === 1 ? 1 : null,
    unitCostInr: n === 1 ? '120.00' : null,
    manufacturedAt: n === 1 ? ago(60 * 24 * 90) : null,
    expiresAt: n === 1 ? ago(-60 * 24 * 400) : null,
    putawayBinId: null,
    primaryImageUrl: null,
    variant: {
      skuCode: long ? 'ELITE-COLLAGEN-COFFEE-FLAVOUR-500G-LIMITED' : `SKU-000${n}`,
      variantLabel: n === 3 ? 'Green / Large' : null,
      product: {
        name: long
          ? 'Elite Collagen (Coffee) premium marine collagen peptide powder, 500 g family pack'
          : `Cotton Kurta ${n}`,
      },
    },
    batch: null,
    putawayBin: null,
    inventoryMode: n === 4 ? 'STRICT' : 'NORMAL',
  };
}

const RECEIPT = {
  id: 'gr-1',
  receiptNumber: 'GR-2026-11-0001',
  status: 'ARRIVING',
  sellerId: 'seller-1',
  warehouseId: 'wh-1',
  expectedArrivalAt: ago(-60 * 24),
  sellerReference: 'PO-MENEV-2026-NOVEMBER-BATCH-2',
  receivedAt: null,
  receivedById: 'staff-1',
  hasDiscrepancies: false,
  discrepancyNotes: null,
  createdAt: ago(60 * 30),
  updatedAt: ago(20),
  consignment: null,
  seller: { id: 'seller-1', companyName: 'Menev Store', email: 'menev@example.com' },
  warehouse: { id: 'wh-1', code: 'CCU-01', name: 'Kolkata main warehouse' },
  receivedBy: { id: 'staff-1', email: 'ops@example.com', emailDisplay: 'ops@example.com' },
  lines: [line(1), line(2), line(3), line(4)],
};

const BINS = ['A-01-01', 'A-01-02', 'B-02-01'].map((code, i) => ({
  id: `bin-${i}`,
  code,
  type: 'STORAGE',
  zoneId: 'z-1',
  aisle: code[0],
  rack: '01',
  shelf: '01',
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path.endsWith('/scan-block')) return json(null);
  if (req.path === '/api/admin/goods-receipts/gr-1' && req.method === 'GET') {
    if (fixture === 'b') return json({ code: 'NOT_FOUND', message: 'No such receipt' }, 404);
    return json(RECEIPT);
  }
  if (req.path === '/api/admin/warehouses/wh-1/bins') return json(BINS);
  if (req.method === 'GET') return json([]);
  return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
};

export default function ReceiveHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['inventory.goods_receipts.manage', 'inventory.view', 'sellers.view']}
    >
      <ReceiveDetailView id="gr-1" />
    </EasyHarness>
  );
}
