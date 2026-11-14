'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AdjustmentsIndex } from '../../../(authed)/inventory/adjustments/_components/adjustments-index';
import { CycleCountsIndex } from '../../../(authed)/inventory/cycle-counts/_components/cycle-counts-index';
import { MovementsIndex } from '../../../(authed)/inventory/movements/_components/movements-index';
import { TransfersIndex } from '../../../(authed)/inventory/transfers/_components/transfers-index';
import { UnitTriageIndex } from '../../../(authed)/inventory-units/_components/unit-triage-index';
import { EasyHarness, json, type Respond } from '../harness';

/**
 * /dev/easy/inventory — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 * The five stock screens with EMPTY lists: headers, filters and forms, which
 * is what a phone-size and touch-target check measures.
 *
 *   ?fixture=a  adjustments   b  cycle counts   c  movements
 *            d  transfers     e  serial units
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e'] as const;
type F = (typeof FIXTURES)[number];

const respond: Respond<F> = (_fixture, req) => {
  if (req.method !== 'GET') return undefined;
  if (req.path === '/api/admin/stock-units/triage') {
    return json({
      generatedAt: new Date().toISOString(),
      sellers: [],
      totalNeedsAttention: 0,
      truncated: false,
      examined: 0,
    });
  }
  // Invented names for the pick-by-name fields on the transfer and
  // adjustment forms.
  if (req.path.startsWith('/api/admin/sellers')) {
    return json({
      items: [
        { id: '01a1cf45-0000-73cf-8f7e-aaaaaaaaaaa1', companyName: 'Dhaka Threads Ltd' },
        {
          id: '01a1cf45-0000-73cf-8f7e-aaaaaaaaaaa2',
          companyName: 'Chittagong Home & Lifestyle Exports Private Limited',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });
  }
  if (req.path === '/api/admin/warehouses') {
    return json([
      { id: 'wh-ccu', name: 'CCU-01', code: 'CCU-01' },
      { id: 'wh-dac', name: 'DAC-01', code: 'DAC-01' },
    ]);
  }
  if (/\/api\/admin\/warehouses\/[^/]+\/bins/.test(req.path)) {
    return json([
      { id: 'bin-1', code: 'A-01-03', type: 'STORAGE' },
      { id: 'bin-2', code: 'PICK-07', type: 'PICKING' },
      { id: 'bin-3', code: 'RTO-HOLD-1', type: 'RTO_HOLD' },
    ]);
  }
  if (req.path.startsWith('/api/admin/warehouse/printing/product-locations')) {
    return json([
      {
        variantId: 'var-1',
        skuCode: 'DT-KURTI-BLU-M',
        productName: 'Cotton kurti with hand block print',
        variantLabel: 'Blue / M',
        barcode: null,
        sellerCompanyName: 'Dhaka Threads Ltd',
        locations: [],
      },
      {
        variantId: 'var-2',
        skuCode: 'DT-KURTI-RED-L',
        productName: 'Cotton kurti with hand block print',
        variantLabel: 'Red / L',
        barcode: null,
        sellerCompanyName: 'Dhaka Threads Ltd',
        locations: [],
      },
    ]);
  }
  if (/warehouses|bins|units/.test(req.path)) return json([]);
  return json({ items: [], total: 0, page: 1, pageSize: 20 });
};

function Screen(): ReactElement | null {
  const [fixture, setFixture] = useState<string | null>(null);
  useEffect(() => {
    setFixture(new URLSearchParams(window.location.search).get('fixture') ?? 'a');
  }, []);
  switch (fixture) {
    case null:
      return null;
    case 'b':
      return <CycleCountsIndex />;
    case 'c':
      return <MovementsIndex />;
    case 'd':
      return <TransfersIndex />;
    case 'e':
      return <UnitTriageIndex />;
    default:
      return <AdjustmentsIndex />;
  }
}

export default function InventoryHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'inventory.view',
        'inventory.adjustments.create',
        'inventory.adjustments.approve',
        'inventory.cycle_counts.manage',
        'inventory.transfers.create',
        'warehouse.view',
        'sellers.view',
      ]}
    >
      <Screen />
    </EasyHarness>
  );
}
