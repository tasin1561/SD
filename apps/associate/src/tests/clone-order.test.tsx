/**
 * "Clone order" (associate): what the prefill copies and what it must
 * not, a foreign order id being a plain "not found", and the list button
 * being offered only with `orders.create`.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

let searchString = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchString),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/orders',
}));

import OrdersPage from '@/app/(authed)/orders/page';
import { CloneBanner } from '@/app/(authed)/_components/clone-banner';
import { useCloneSeed } from '@/lib/clone-order-hooks';
import { buildStoreClone, cloneHref, type CloneSourceOrder } from '@/lib/clone-order';
import type { SellCatalogueItem } from '@/lib/catalogue-hooks';
import { makeAssociate, renderAssociateScreen } from './helpers';

const ORDER_ID = '0192f3a0-0000-7000-8000-000000000001';

const SOURCE: CloneSourceOrder = {
  orderNumber: 'SD-200',
  recipient: {
    name: 'Ravi Kumar',
    phoneE164: '+919876543210',
    email: 'ravi@example.com',
    addressLine1: '12 MG Road',
    addressLine2: 'Near the temple',
    landmark: null,
    postalCode: '560001',
  },
  paymentMode: 'COD',
  codAmountInr: '1000.00',
  deliveryFeeInr: null,
  notes: 'Gift wrap',
  lines: [
    { variantId: 'v1', skuCode: 'SKU-1', quantity: 2, retailUnitInr: '500.00' },
    { variantId: 'v2', skuCode: 'SKU-2', quantity: 1, retailUnitInr: '900.00' },
    { variantId: 'v3', skuCode: 'SKU-GONE', quantity: 1, retailUnitInr: '100.00' },
  ],
};

function item(id: string, price: string | null): SellCatalogueItem {
  return {
    variantId: id,
    skuCode: id,
    title: id,
    variantLabel: null,
    imageUrls: [],
    retailPriceInr: price,
    availableQuantity: 5,
  } as SellCatalogueItem;
}

describe('buildStoreClone', () => {
  const catalogue = [item('v1', '500.00'), item('v2', '800'), item('v3', null)];

  it('copies recipient, payment, notes, quantities; leaves reference/fee/charges out', () => {
    const seed = buildStoreClone(SOURCE, catalogue);
    expect(seed.fields).toMatchObject({
      name: 'Ravi Kumar',
      phone: '+919876543210',
      email: 'ravi@example.com',
      line1: '12 MG Road',
      landmark: 'Near the temple',
      pin: '560001',
      notes: 'Gift wrap',
      payment: 'COD',
    });
    expect(Object.keys(seed.fields)).not.toContain('reference');
    expect(Object.keys(seed.fields)).not.toContain('deliveryFee');
    expect(seed.lines.map((l) => [l.variantId, l.quantity])).toEqual([
      ['v1', '2'],
      ['v2', '1'],
    ]);
  });

  it('flags a price that moved, drops a product with no price row, sends no price at all', () => {
    const seed = buildStoreClone(SOURCE, catalogue);
    expect(seed.repriced).toEqual(['SKU-2']);
    expect(seed.dropped).toEqual(['SKU-GONE']);
    expect(Object.keys(seed.lines[0] ?? {})).toEqual(['variantId', 'quantity']);
  });

  it('copies the COD amount only when nothing had to change', () => {
    const clean = { ...SOURCE, lines: SOURCE.lines.slice(0, 1) };
    expect(buildStoreClone(clean, catalogue).fields.codAmount).toBe('1000');
    expect(buildStoreClone(SOURCE, catalogue).fields.codAmount).toBe('');
    expect(buildStoreClone({ ...clean, deliveryFeeInr: '40.00' }, catalogue).fields.codAmount).toBe(
      '',
    );
  });
});

describe('useCloneSeed', () => {
  function Harness() {
    return <CloneBanner clone={useCloneSeed([])} />;
  }
  it('a foreign order (404 from the scoped read) is a plain not-found', async () => {
    searchString = `cloneFrom=${ORDER_ID}`;
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }),
    );
    renderAssociateScreen(<Harness />, { fetchImpl });
    expect(await screen.findByText(/could not find that order to copy/i)).toBeInTheDocument();
  });
});

describe('the Clone order button in the list', () => {
  const page = {
    items: [
      {
        id: ORDER_ID,
        orderNumber: 'SD-200',
        sellerOrderRef: null,
        status: 'PENDING_CONFIRMATION',
        placedAt: '2026-11-01T05:00:00.000Z',
        recipientName: 'Ravi',
        recipientPhoneE164: '+919876543210',
        recipientCity: 'Bengaluru',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        codAmountInr: '1000.00',
        itemCount: 1,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  };
  const fetchImpl = (): ReturnType<typeof vi.fn> =>
    vi.fn(async () => new Response(JSON.stringify(page), { status: 200 }));

  it('is a link with ?cloneFrom= when the caller may create orders', async () => {
    searchString = '';
    renderAssociateScreen(<OrdersPage />, {
      identity: makeAssociate({ permissions: ['orders.view', 'orders.create'] }),
      fetchImpl: fetchImpl(),
    });
    const link = await screen.findByRole('link', { name: /clone order SD-200/i });
    expect(link).toHaveAttribute('href', cloneHref(ORDER_ID));
  });

  it('is absent without orders.create', async () => {
    searchString = '';
    renderAssociateScreen(<OrdersPage />, {
      identity: makeAssociate({ permissions: ['orders.view'] }),
      fetchImpl: fetchImpl(),
    });
    await screen.findByText('SD-200');
    expect(screen.queryByRole('link', { name: /clone order/i })).toBeNull();
  });
});
