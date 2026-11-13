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
