'use client';

import type { ReactElement } from 'react';
import { PrintingStation } from '../../../(authed)/warehouse/printing/_components/printing-station';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/printing — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1). The
 * printing bench with real-looking parcels waiting for a label.
 *
 *   ?fixture=a  six parcels waiting for labels and for a picking list
 *            b  nothing waiting
 */
const FIXTURES = ['a', 'b'] as const;
type F = (typeof FIXTURES)[number];

const ROWS = [0, 1, 2, 3, 4, 5].map((i) => ({
  shipmentId: `sh${i}`,
  shipmentNumber: `SHP-2026-0009${i}`,
  orderId: `01a1cf45-0000-73cf-8f7e-99999999990${i}`,
  orderNumber: `SD-2026-26-00019${i}`,
  sellerCompanyName:
    i === 1 ? 'Chittagong Home & Lifestyle Exports Private Limited' : 'Dhaka Threads Ltd',
  warehouseId: 'wh-1',
  warehouseName: 'Kolkata main warehouse',
  courierCode: i === 4 ? 'SHIPROCKET' : 'DELHIVERY',
  courierName: i === 4 ? 'Shiprocket — Blue Dart Air Express Priority' : 'Delhivery',
  awbNumber: i === 5 ? null : `3704581020${i}`,
  isManualCourier: i === 5,
  destCity: ['Kolkata', 'Thiruvananthapuram', 'New Delhi', 'Leh', 'Bengaluru', 'Pune'][i],
  destPostalCode: ['700001', '695001', '110001', '194101', '560001', '411001'][i],
  codAmountInr: i === 2 ? null : '1499.00',
  itemCount: i + 1,
  confirmedAtIso: ago(60 * (i + 1) * 2),
  labelPrintedAtIso: null,
  labelPrintCount: 0,
  packCompletedAtIso: null,
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path.endsWith('/scan-block')) return json(null);
  if (/printing\/label-groups$/.test(req.path))
    return json(
      fixture === 'b'
        ? { groupSize: 30, totalParcels: 0, groups: [] }
        : {
            groupSize: 30,
            totalParcels: 97,
            groups: [
              ['Delhivery · Group 1', 30, 60 * 50],
              ['Delhivery · Group 2', 30, 60 * 26],
              ['Delhivery · Group 3', 7, 90],
              ['Shiprocket — Blue Dart Air Express Priority · Group 1', 30, 60 * 5],
            ].map(([label, size, mins], i) => ({
              key: `g${i}`,
              courierCode: i === 3 ? 'SHIPROCKET' : 'DELHIVERY',
              courierName: i === 3 ? 'Shiprocket' : 'Delhivery',
              warehouseId: 'wh-1',
              label,
              size,
              shipmentIds: Array.from({ length: size as number }, (_, n) => `g${i}-s${n}`),
              oldestPlacedAt: ago(mins as number),
            })),
          },
    );
  if (/printing\/label-groups\/print$/.test(req.path))
    return json({
      batchId: 'b-42',
      batchNumber: 'PB-2026-11-000042',
      pdfBase64: 'JVBERi0xLjQKJSVFT0YK',
      fileName: 'labels-PB-2026-11-000042.pdf',
      shipmentCount: 59,
      pageCount: 59,
      failed: [
        {
          shipmentId: 'x1',
          shipmentNumber: 'SHP-2026-00095',
          reason: 'This parcel has no AWB yet.',
        },
      ],
      replayed: false,
    });
  if (/printing\/(label-queue|pick-queue)$/.test(req.path))
    return json(fixture === 'b' ? [] : ROWS);
  if (req.method === 'GET') return json([]);
  return json({ code: 'DEV_PAGE', message: 'This is a test page. Nothing was changed.' }, 409);
};

export default function PrintingHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'warehouse.view',
        'warehouse.manage',
        'warehouse.labels.reprint',
        'orders.view',
      ]}
    >
      <PrintingStation />
    </EasyHarness>
  );
}
