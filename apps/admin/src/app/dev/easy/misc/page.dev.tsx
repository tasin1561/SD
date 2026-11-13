'use client';

import { Suspense, useEffect, useState, type ReactElement } from 'react';
import ResellerStoresPage from '../../../(authed)/reseller-stores/page';
import AdminResellerStorePage from '../../../(authed)/reseller-stores/[storeId]/page';
import ResellerAnalysisPage from '../../../(authed)/reseller-stores/analysis/page';
import { PickStation } from '../../../(authed)/warehouse/pick/_components/pick-station';
import { ManifestsIndex } from '../../../(authed)/warehouse/manifests/_components/manifests-index';
import { ManifestDetailView } from '../../../(authed)/warehouse/manifests/_components/manifest-detail-view';
import '../../../(authed)/warehouse/_components/benches.css';
import '@/components/easy/easy.css';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/misc — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). Mock data
 * only; every write is refused.
 *
 *   ?mode=p  lists answer as a page object (default)   a  as a bare array
 *         n  nothing is mocked: each screen shows its "could not load" state
 *
 *   a  member stores   b  one member store   c  member-store analysis
 *   d  pick bench      e  manifests          f  one manifest
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
type F = (typeof FIXTURES)[number];

const PERMISSIONS = [
  'money.treasury.view',
  'money.view',
  'reseller.stores.manage',
  'reseller.stores.pause',
  'support.impersonate',
  'warehouse.manifest.close',
  'warehouse.view',
  'orders.view',
  'sellers.view',
];

const PICK = {
  pickId: 'p1',
  shipmentId: 'sh1',
  shipmentNumber: 'SHP-2026-00120',
  orderId: '01a1cf45-0000-73cf-8f7e-121212121212',
  pickStartedAt: ago(1),
  pickExpiresAt: ago(-14),
  order: null,
  items: [1, 2, 3].map((n) => ({
    shipmentItemId: `si-${n}`,
    orderItemId: `oi-${n}`,
    skuCode: n === 2 ? 'ELITE-COLLAGEN-COFFEE-FLAVOUR-500G-LIMITED' : `SKU-000${n}`,
    productName:
      n === 2
        ? 'Elite Collagen (Coffee) premium marine collagen peptide powder, 500 g family pack'
        : `Cotton Kurta ${n}`,
    variantLabel: n === 3 ? 'Green / Large' : null,
    quantity: n,
    unitWeightGrams: 250,
    variantId: `v-${n}`,
    inventoryMode: 'NORMAL',
  })),
};

const STORES = ['PENDING_SELLER_APPROVAL', 'ACTIVE', 'PAUSED', 'ACTIVE'].map((status, i) => ({
  id: `st${i}`,
  sellerId: 's1',
  sellerCompanyName:
    i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  name: `riya-fashion-house-${i}`,
  displayName: i === 2 ? null : 'Riya Fashion House and Lifestyle Boutique',
  status,
  origin: i % 2 === 0 ? 'SELLER' : 'ADMIN',
  walletManagedBy: i === 3 ? 'SKYDROP' : 'SELLER',
  contactEmail: 'riya.fashion.house.owner@example.com',
  contactPhone: '+8801712345678',
  note: i === 0 ? 'Asked to join after the Eid sale.' : null,
  memberCount: i + 1,
  createdAt: ago(60 * 24 * (i + 2)),
  statusChangedAt: i === 0 ? null : ago(60 * 24),
}));

const respond: Respond<F> = (_fixture, req) => {
  if (req.method === 'POST' && req.path === '/api/warehouse/picks/next')
    return json({ pick: PICK });
  if (req.method !== 'GET')
    return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
  if (req.path.endsWith('/scan-block')) return json(null);
  if (req.path === '/api/admin/reseller-stores') return json(STORES);
  const mode = new URLSearchParams(window.location.search).get('mode') ?? 'p';
  if (mode === 'n') return undefined;
  if (mode === 'a') return json([]);
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
      return <AdminResellerStorePage />;
    case 'c':
      return <ResellerAnalysisPage />;
    case 'd':
      return (
        <div className="wh-page ez-touch">
          <PickStation />
        </div>
      );
    case 'e':
      return <ManifestsIndex />;
    case 'f':
      return <ManifestDetailView id="m1" />;
    default:
      return <ResellerStoresPage />;
  }
}

export default function MiscHarness(): ReactElement {
  return (
    <EasyHarness fixtures={FIXTURES} respond={respond} permissions={() => PERMISSIONS}>
      <Suspense fallback={null}>
        <Screen />
      </Suspense>
    </EasyHarness>
  );
}
