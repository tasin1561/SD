'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import { MoneyDisplayProvider, Toaster } from '@skydrop/ui/components';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import type { SellerMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import { OrdersIndex } from '../../(authed)/orders/_components/orders-index';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/awb-list — the REAL client orders list against MOCKED responses, to
 * look at the AWB + copy button on a desktop and a phone. DEV ONLY
 * (`page.dev.tsx`, compiled only when APPS_DEV_ROUTES=1).  ?theme=light|dark
 */
function row(i: number, awb: string | null, status: string) {
  return {
    id: `o${i}`,
    orderNumber: `SD-2611-00${i}`,
    sellerOrderRef: i % 2 ? `#${1040 + i}` : null,
    status,
    source: 'MANUAL',
    recipientName: ['Aarav Sharma', 'Meera Iyer', 'Rohan Das', 'Priya Nair'][i % 4],
    recipientPhoneE164: `+9198765432${i}0`,
    recipientCity: '',
    recipientStateProvince: 'Delhi',
    recipientPostalCode: '1100' + (10 + i),
    codAmountInr: i % 3 === 0 ? null : String(799 + i * 100),
    placedAt: new Date(Date.now() - i * 3_600_000 * 5).toISOString(),
    sellerId: 's1',
    shipment:
      awb === null
        ? null
        : {
            awbNumber: awb,
            courierCode: 'delhivery',
            courierDisplayName: 'Delhivery',
            manualCourierName: null,
            weightGrams: 500,
            lengthCm: null,
            widthCm: null,
            heightCm: null,
          },
  };
}
const ITEMS = [
  row(1, '38061110634966', 'IN_TRANSIT'),
  row(2, '38061110634977', 'OUT_FOR_DELIVERY'),
  row(3, null, 'CONFIRMED'),
  row(4, '38061110635012', 'DELIVERED'),
  row(5, null, 'PENDING_CONFIRMATION'),
];

function install(): void {
  const w = window as unknown as { __awbFetch?: boolean };
  if (w.__awbFetch === true) return;
  w.__awbFetch = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    const json = (b: unknown, s = 200): Response =>
      new Response(JSON.stringify(b), {
        status: s,
        headers: { 'content-type': 'application/json' },
      });
    if (url.pathname === '/api/seller/orders') {
      return json({ items: ITEMS, total: ITEMS.length, page: 1, pageSize: 20 });
    }
    if (url.pathname === '/api/seller/orders/summary') {
      return json({
        byStatus: [{ status: 'IN_TRANSIT', count: 2, codInr: '1698' }],
        total: ITEMS.length,
        totalCodInr: '3000',
      });
    }
    return json([]);
  };
}

export default function AwbListHarness(): ReactElement | null {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    install();
    const th = new URLSearchParams(window.location.search).get('theme');
    document.documentElement.dataset['theme'] = th === 'dark' ? 'dark' : 'light';
    setReady(true);
  }, []);
  const identity = {
    id: 'u',
    roleKey: 'owner',
    roleName: 'Owner',
    roleKeys: ['owner'],
    roleNames: ['Owner'],
    permissions: ['orders.view', 'orders.create'],
    email: 'dev@skydrop.global',
    emailDisplay: 'dev@skydrop.global',
    companyName: 'Dev Store',
    displayCurrency: 'INR',
    displayFxRate: null,
    equivalentFxRate: '1.43',
  } as unknown as SellerMe;
  if (!ready) return null;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--page)', padding: 16 }}>
      <LocaleProvider initialLocale="en">
        <QueryProvider>
          <AuthProvider<SellerMe> identityKind="seller" initialIdentity={identity}>
            <MoneyDisplayProvider value={{ currency: 'INR', rate: null, equivalentRate: '1.43' }}>
              <Toaster>
                <ToastProvider>
                  <OrdersIndex />
                </ToastProvider>
              </Toaster>
            </MoneyDisplayProvider>
          </AuthProvider>
        </QueryProvider>
      </LocaleProvider>
    </div>
  );
}
