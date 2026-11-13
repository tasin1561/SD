'use client';

import type { ReactElement } from 'react';
import { HoldsBoard } from '../../../(authed)/warehouse/holds/_components/holds-board';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/wh-holds — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  held, free and stuck work, two reprints   b  nothing held   c  fails to load
 */
const FIXTURES = ['a', 'b', 'c'] as const;
type F = (typeof FIXTURES)[number];

const KINDS = ['PICK', 'PACK_CLAIM', 'PACK_BOX', 'PICK_BATCH', 'PICK'];
const staff = (name: string): { kind: string; name: string } => ({ kind: 'STAFF', name });

const HOLDS = KINDS.map((kind, i) => ({
  key: `k${i}`,
  kind,
  holder: staff(
    i === 1 ? 'mohammad.salahuddin.chowdhury@skydrop.global' : 'rina.akter@skydrop.global',
  ),
  shipmentNumber: kind === 'PICK_BATCH' ? null : `SHP-2026-0004${i}`,
  awbNumber: i % 2 === 0 ? `3704581002${i}` : null,
  orderId: kind === 'PICK_BATCH' ? null : `01a1cf45-0000-73cf-8f7e-cccccccccc${i}0`,
  orderNumber: kind === 'PICK_BATCH' ? null : `SD-2026-26-00013${i}`,
  batchNumber: kind === 'PICK_BATCH' ? 'PB-2026-00017' : null,
  warehouseName: 'Kolkata main warehouse',
  sinceIso: ago(12 * (i + 1)),
  untilIso: i === 2 ? null : ago(i >= 3 ? 20 : -15),
  expired: i >= 3,
  stuck: i === 4,
  detail: kind === 'PICK' ? { unpicked: 2, of: 5 } : null,
}));

const REPRINTS = [0, 1].map((i) => ({
  shipmentId: `rp${i}`,
  shipmentNumber: `SHP-2026-0005${i}`,
  awbNumber: `3704581003${i}`,
  orderId: `01a1cf45-0000-73cf-8f7e-dddddddddd${i}0`,
  orderNumber: `SD-2026-26-00014${i}`,
  warehouseName: 'Kolkata main warehouse',
  sheets: i + 2,
  lastPrintedBy: staff('rina.akter@skydrop.global'),
  lastPrintedAtIso: i === 0 ? ago(25) : null,
  labelVersions: i + 1,
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/warehouse/holds') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    return json({
      nowIso: new Date().toISOString(),
      stuckAfterMinutes: 30,
      holds: fixture === 'b' ? [] : HOLDS,
      reprints: fixture === 'b' ? [] : REPRINTS,
    });
  }
  return undefined;
};

export default function WhHoldsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['warehouse.view', 'orders.view']}
    >
      <HoldsBoard />
    </EasyHarness>
  );
}
