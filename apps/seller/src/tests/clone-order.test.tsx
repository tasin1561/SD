/**
 * "Clone order": what the prefill copies and what it must not, a foreign
 * order id being a plain "not found", and the button being offered only to
 * somebody who may create an order — on the detail header and in the list.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { OrderView } from '@skydrop/api-client';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchString),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/orders',
}));

import { OrderHeader } from '@/app/(authed)/orders/_components/detail/order-header';
import { OrdersIndex } from '@/app/(authed)/orders/_components/orders-index';
import { CloneBanner } from '@/app/(authed)/orders/_components/clone-banner';
import { useCloneSeed } from '@/lib/clone-order-hooks';
import { buildSellerClone, cloneHref, type CloneCatalogueHit } from '@/lib/clone-order';
import { buildFetchMock, makeSeller, renderWithProviders } from './helpers';

let searchString = '';
const ORDER_ID = '0192f3a0-0000-7000-8000-000000000001';

const SOURCE = {
  orderNumber: 'SD-100',
  recipientName: 'AB Ravi Kumar',
  recipientPhoneE164: '+919876543210',
  recipientAddressLine1: '12 MG Road',
  recipientAddressLine2: 'Near the temple',
  recipientLandmark: null,
  recipientPostalCode: '560001',
  paymentMode: 'COD',
  sellerNotes: 'Gift wrap',
  items: [
    { variantId: 'v1', skuCode: 'SKU-1', quantity: 2, unitPriceInr: '500.00' },
    { variantId: 'v2', skuCode: 'SKU-2', quantity: 1, unitPriceInr: '300.00' },
    { variantId: 'v3', skuCode: 'SKU-GONE', quantity: 1, unitPriceInr: '100.00' },
  ],
};

function hit(id: string, sku: string, price: string | null): CloneCatalogueHit {
  return {
    id,
    skuCode: sku,
    productName: `Product ${sku}`,
    variantLabel: null,
    primaryImageUrl: null,
    effectiveWeightGrams: 250,
    effectiveDeclaredValueInr: price,
  };
}

describe('buildSellerClone', () => {
  const hits = new Map([
    ['v1', hit('v1', 'SKU-1', '500.00')],
    ['v2', hit('v2', 'SKU-2', '350.00')],
  ]);
  const seed = buildSellerClone(SOURCE, hits, 'AB');

  it('copies the recipient, payment mode, notes and quantities', () => {
    expect(seed.fields).toEqual({
      recipientName: 'Ravi Kumar',
      recipientPhoneE164: '+919876543210',
      recipientAddressLine1: '12 MG Road',
      recipientAddressLine2: 'Near the temple',
      recipientPostalCode: '560001',
      paymentMode: 'COD',
      sellerNotes: 'Gift wrap',
    });
    expect(seed.lines.map((l) => [l.variantId, l.quantity])).toEqual([
      ['v1', '2'],
      ['v2', '1'],
    ]);
  });

  it('never carries a reference, order number, status, AWB or any charge', () => {
    const copied = JSON.stringify(seed.fields) + JSON.stringify(seed.lines);
    for (const forbidden of [
      'sellerOrderRef',
      'orderNumber',
      'status',
      'awb',
      'deliveryFee',
      'discount',
      'advance',
      'codAmount',
      'addressCheck',
    ])
      expect(copied).not.toContain(forbidden);
  });

  it('prices from today’s catalogue, flags a changed price, drops a vanished product', () => {
    expect(seed.lines.find((l) => l.variantId === 'v2')?.unitPriceInr).toBe('350.00');
    expect(seed.repriced).toEqual(['SKU-2']);
    expect(seed.dropped).toEqual(['SKU-GONE']);
  });
});

describe('useCloneSeed', () => {
  function Harness() {
    return <CloneBanner clone={useCloneSeed()} />;
  }

  it('a foreign order id (404 from the scoped read) is a plain not-found', async () => {
    searchString = `cloneFrom=${ORDER_ID}`;
    const fetchImpl = buildFetchMock([
      {
        match: /seller\/orders\/0192f3a0/,
        responses: [{ status: 404, body: { code: 'NOT_FOUND' } }],
      },
    ]);
    renderWithProviders(<Harness />, { fetchImpl });
    expect(await screen.findByText(/could not find that order to copy/i)).toBeInTheDocument();
  });

  it('a malformed id never reaches the API', () => {
    searchString = 'cloneFrom=not-an-id';
    const fetchImpl = buildFetchMock([]);
    renderWithProviders(<Harness />, { fetchImpl });
    expect(screen.getByText(/could not find that order to copy/i)).toBeInTheDocument();
    expect(fetchImpl.mock.calls.some((c) => /seller\/orders\//.test(String(c[0])))).toBe(false);
  });
});

describe('the Clone order button', () => {
  const order = {
    id: ORDER_ID,
    orderNumber: 'SD-100',
    sellerOrderRef: null,
    status: 'DELIVERED',
    paymentMode: 'COD',
    placedAt: '2026-11-01T05:00:00.000Z',
    updatedAt: '2026-11-02T05:00:00.000Z',
  } as unknown as OrderView;
  const base = { askAdmin: null, raiseIssue: () => undefined, editHref: null, reattempt: null };

  it('detail header links to the create form with ?cloneFrom=', () => {
    renderWithProviders(
      <OrderHeader
        order={order}
        actions={{ ...base, requestReturn: null, cancel: null, cloneHref: cloneHref(ORDER_ID) }}
      />,
    );
    expect(screen.getByRole('link', { name: /clone order/i })).toHaveAttribute(
      'href',
      `/orders/new?cloneFrom=${ORDER_ID}`,
    );
  });

  it('detail header hides it without the create permission (cloneHref null)', () => {
    renderWithProviders(
      <OrderHeader
        order={order}
        actions={{ ...base, requestReturn: null, cancel: null, cloneHref: null }}
      />,
    );
    expect(screen.queryByRole('link', { name: /clone order/i })).toBeNull();
  });

  const LIST = /api\/seller\/orders\?/;
  const row = {
    id: ORDER_ID,
    orderNumber: 'SD-100',
    sellerOrderRef: null,
    status: 'PENDING_CONFIRMATION',
    recipientName: 'Ravi',
    recipientCity: '',
    recipientPostalCode: '560001',
    recipientPhoneE164: '+919876543210',
    codAmountInr: '999.00',
    placedAt: '2026-11-01T05:00:00.000Z',
    shipment: null,
  };
  const page = { items: [row], total: 1, page: 1, pageSize: 25 };

  it('each list row has a clone link when the caller can create orders', async () => {
    searchString = '';
    const fetchImpl = buildFetchMock([{ match: LIST, responses: [{ status: 200, body: page }] }]);
    renderWithProviders(<OrdersIndex />, { fetchImpl });
    const link = await screen.findByRole('link', { name: /clone order SD-100/i });
    expect(link).toHaveAttribute('href', `/orders/new?cloneFrom=${ORDER_ID}`);
  });

  it('no clone link in the list without orders.create', async () => {
    searchString = '';
    const fetchImpl = buildFetchMock([{ match: LIST, responses: [{ status: 200, body: page }] }]);
    renderWithProviders(<OrdersIndex />, {
      fetchImpl,
      identity: makeSeller({ permissions: ['orders.view'] }),
    });
    await screen.findByText('SD-100');
    await waitFor(() => expect(screen.queryByRole('link', { name: /clone order/i })).toBeNull());
  });
});
