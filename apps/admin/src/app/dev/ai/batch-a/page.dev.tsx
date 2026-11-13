'use client';

import { useMemo, type ReactElement } from 'react';
import { AssistantWidget, TicketPhotos, type AssistantTransport } from '@skydrop/ui/app/assistant';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/ai/batch-a — "Ask AI why", the "what needs my attention" card and a
 * ticket's photos, against a MOCKED transport (no API, no key).
 *
 * DEV ONLY: `page.dev.tsx` compiles only under APPS_DEV_ROUTES=1.
 */
/** Signed links are https; the screenshot script answers this host itself. */
const swatch = (fill: string, label: string): string =>
  `https://photos.test/${encodeURIComponent(fill)}/${encodeURIComponent(label)}.svg`;

const PHOTOS = {
  items: [
    {
      id: 'p1',
      kind: 'IMAGE',
      mediaType: 'image/png',
      name: 'damaged-box.png',
      bytes: 1,
      url: swatch('#b45309', 'Damaged box'),
    },
    {
      id: 'p2',
      kind: 'IMAGE',
      mediaType: 'image/png',
      name: 'label.png',
      bytes: 1,
      url: swatch('#1d4ed8', 'Label'),
    },
    {
      id: 'p3',
      kind: 'PDF',
      mediaType: 'application/pdf',
      name: 'invoice.pdf',
      bytes: 1,
      url: 'https://example.test/invoice.pdf',
    },
  ],
};

function makeTransport(): AssistantTransport {
  return {
    request: async <T,>(path: string): Promise<T> => {
      if (path.endsWith('/status')) {
        return { enabled: true, permissions: ['orders.view', 'wallet.view'] } as T;
      }
      if (path === '/api/seller/orders/summary') {
        return {
          byStatus: [
            { status: 'AWAITING_SELLER_DECISION', count: 4 },
            { status: 'DELIVERY_FAILED', count: 2 },
          ],
        } as T;
      }
      if (path === '/api/seller/nsa') return [{}, {}, {}] as T;
      if (path === '/api/seller/wallet') {
        return { balances: [{ currency: 'INR', balance: '-120.00', isConverted: false }] } as T;
      }
      return [] as unknown as T;
    },
    requestStream: async () => {
      throw new Error('mock');
    },
  };
}

export default function BatchAHarness(): ReactElement {
  const transport = useMemo(makeTransport, []);
  return (
    <main style={{ padding: 16, minHeight: '100vh', maxWidth: 720 }}>
      <ErrorState
        message="[ORDER_LOCKED] This order is locked because the parcel is already with the courier."
        retry={() => undefined}
      />
      <TicketPhotos ticketId="t1" fetcher={async () => PHOTOS} />
      <AssistantWidget console="seller" pathname="/orders/0192" transport={transport} />
    </main>
  );
}
