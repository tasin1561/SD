'use client';

import { useState, type ReactElement } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import { Toaster } from '@skydrop/ui/components';
import type { StaffMe } from '@skydrop/api-client';
import type { PickBatchView } from '@/lib/ops-hooks';
import { QueryProvider } from '@/components/query-provider';
import { ShortPickDialog } from '../../(authed)/warehouse/printing/_components/short-pick-dialog';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/short-pick — the short-pick sheet with fixture lines, so its LAYOUT
 * can be looked at in a real browser at a real width.
 *
 * DEV ONLY: `page.dev.tsx` compiles only when APPS_DEV_ROUTES=1 (see
 * next.config.mjs), so it cannot reach a production chunk.
 *
 * It exists because the sheet only appears on a PRINTED pick batch, and
 * production had none — the honest alternatives were to flip a real
 * batch's state for a screenshot, or to never look at it on a phone. The
 * fixture is deliberately awkward: a long product name, a three-line
 * parcel and a single-unit line, which is where a stepper row breaks if
 * it is going to.
 */
const BATCH: PickBatchView = {
  id: 'b-dev',
  batchNumber: 'PB-DEV-01',
  status: 'PRINTED' as PickBatchView['status'],
  warehouseId: 'w-1',
  warehouseName: 'Delhi',
  shipmentCount: 2,
  totalUnits: 0,
  createdAtIso: '2026-11-10T00:00:00Z',
  createdByName: 'Rakib Hasan',
  printedAtIso: '2026-11-10T01:00:00Z',
  printedByName: 'Rakib Hasan',
  printCount: 1,
  shipments: [
    {
      shipmentId: 's-1',
      shipmentNumber: 'SHP-00001',
      orderNumber: 'SD-10001',
      awbNumber: '38061110627373',
      items: [
        {
          shipmentItemId: 'si-1',
          skuCode: 'MST-SUNG-01',
          productName: 'Aviator sunglasses, polarised, gold frame — large',
          variantLabel: 'Gold / Large',
          quantity: 3,
        },
        {
          shipmentItemId: 'si-2',
          skuCode: 'MST-CAP-02',
          productName: 'Cotton cap',
          variantLabel: null,
          quantity: 1,
        },
        {
          shipmentItemId: 'si-3',
          skuCode: 'MST-BELT-03',
          productName: 'Leather belt',
          variantLabel: '34 inch',
          quantity: 12,
        },
      ],
    },
    {
      shipmentId: 's-2',
      shipmentNumber: 'SHP-00002',
      orderNumber: 'SD-10002',
      awbNumber: null,
      items: [
        {
          shipmentItemId: 'si-4',
          skuCode: 'MST-WATCH-04',
          productName: 'Wrist watch',
          variantLabel: null,
          quantity: 2,
        },
      ],
    },
  ],
};

/**
 * The same provider stack the real bench sits inside: QueryProvider,
 * AuthProvider and Toaster. The sheet's Save goes through the real
 * `useRecordShortPick` and the real ApiClient, so without these it threw
 * on a missing context and the page 500'd — which is itself worth
 * knowing, since it means the layout below is the real component and not
 * a lookalike.
 */
const IDENTITY = {
  id: 'staff-dev',
  email: 'dev@skydrop.global',
  emailDisplay: 'dev@skydrop.global',
  permissions: ['warehouse.view', 'warehouse.pick'],
} as unknown as StaffMe;

export default function ShortPickHarness(): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <QueryProvider>
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={IDENTITY}>
        <Toaster>
          <main style={{ padding: 16 }}>
            {/* Labelled with the batch number rather than a sentence:
                the i18n guard scans every component for hard-coded
                English JSX text, dev routes included, and it is right to
                — an exception for this file is a hole someone ships real
                copy through later. */}
            <button type="button" onClick={() => setOpen(true)}>
              {BATCH.batchNumber}
            </button>
            <ShortPickDialog batch={BATCH} open={open} onOpenChange={setOpen} />
          </main>
        </Toaster>
      </AuthProvider>
    </QueryProvider>
  );
}
