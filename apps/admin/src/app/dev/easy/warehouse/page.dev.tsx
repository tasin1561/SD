'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { BinsIndex } from '../../../(authed)/warehouse/bins/_components/bins-index';
import { ConsignmentsIndex } from '../../../(authed)/warehouse/consignments/_components/consignments-index';
import { PrintingStation } from '../../../(authed)/warehouse/printing/_components/printing-station';
import { ReceiveIndex } from '../../../(authed)/warehouse/receive/_components/receive-index';
import { RtoStation } from '../../../(authed)/warehouse/rto/_components/rto-station';
import '../../../(authed)/warehouse/_components/benches.css';
import '@/components/easy/easy.css';
import { EasyHarness, json, type Respond } from '../harness';

/**
 * /dev/easy/warehouse — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 * Five warehouse screens with EMPTY lists: headers, tabs, filters and forms,
 * which is what a phone-size and touch-target check measures.
 *
 *   ?fixture=a  bins   b  consignments   c  printing   d  receive   e  returns
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e'] as const;
type F = (typeof FIXTURES)[number];

const respond: Respond<F> = (_fixture, req) => {
  if (req.method !== 'GET') return undefined;
  if (req.path.endsWith('/scan-block')) return json(null);
  if (/warehouses|bins$|couriers|awaiting|open-returns|worklist/.test(req.path)) return json([]);
  return json({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    waiting: [],
    inProgress: [],
    shipments: [],
    batches: [],
    parcels: [],
  });
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
      return <ConsignmentsIndex />;
    case 'c':
      return <PrintingStation />;
    case 'd':
      return (
        <div className="wh-page ez-touch">
          <ReceiveIndex />
        </div>
      );
    case 'e':
      return (
        <div className="wh-page ez-touch">
          <RtoStation />
        </div>
      );
    default:
      return <BinsIndex />;
  }
}

export default function WarehouseHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'inventory.view',
        'inventory.adjustments.create',
        'inventory.goods_receipts.manage',
        'inventory.transfers.manage',
        'sellers.view',
        'warehouse.bins.collapse',
        'warehouse.labels.reprint',
        'warehouse.manage',
        'warehouse.view',
        'orders.view',
      ]}
    >
      <Screen />
    </EasyHarness>
  );
}
