/**
 * Pick by name instead of typing an id — `components/easy/id-picks.tsx`.
 *
 * The stock forms used to ask for a client id, a product id and a shelf id
 * as raw text. These pieces offer the same choice by name. What must hold:
 * the id handed back is the one from the list, and the typed id field is
 * still there (never removed), on its own when the list cannot be read.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ may: true }));

vi.mock('@/lib/use-permission', () => ({ usePermission: () => state.may }));
vi.mock('@/lib/api-hooks', () => ({
  useSellersList: () => ({
    data: { items: [{ id: 'seller-1', companyName: 'Dhaka Threads Ltd' }] },
  }),
  useOrdersList: (query: { search: string }, opts: { enabled: boolean }) => ({
    isError: false,
    isLoading: false,
    data: !opts.enabled
      ? undefined
      : {
          items: [
            {
              id: 'order-1',
              orderNumber: 'SD-10231',
              recipientName: 'Anita Rao',
              status: 'DELIVERED',
              codAmountInr: '1499.00',
            },
          ].filter((o) => o.orderNumber.includes(query.search)),
        },
  }),
  useRemittancesList: (query: { sellerId: string }) => ({
    data: {
      items: [
        {
          id: 'rem-1',
          sellerId: 'seller-1',
          currency: 'BDT',
          amount: '16800.00',
          bankReference: 'UTR2611130001',
          paidAt: '2026-11-13T06:00:00.000Z',
        },
        {
          id: 'rem-other',
          sellerId: 'seller-2',
          currency: 'BDT',
          amount: '1.00',
          bankReference: 'NOT-THEIRS',
          paidAt: '2026-11-13T06:00:00.000Z',
        },
      ].filter(() => query.sellerId !== ''),
    },
  }),
  useStaffUsersList: () => ({
    data: [{ id: 'staff-1', emailDisplay: 'ops@example.test', roleNames: ['Warehouse lead'] }],
  }),
}));
vi.mock('@/lib/reseller-store-hooks', () => ({
  useAdminResellerStores: () => ({
    data: [
      {
        id: 'store-1',
        name: 'rupa',
        displayName: 'Rupa Boutique',
        sellerCompanyName: 'Dhaka Threads Ltd',
      },
    ],
  }),
}));
vi.mock('@/lib/bin-contents-hooks', () => ({
  useBinOptions: (warehouseId: string) => ({
    isError: false,
    data: warehouseId === '' ? undefined : [{ id: 'bin-1', code: 'A-01-03', type: 'STORAGE' }],
  }),
}));
vi.mock('@/lib/ops-hooks', () => ({
  useProductLocations: (query: string) => ({
    isError: false,
    isLoading: false,
    data:
      query.trim().length < 2
        ? undefined
        : [
            {
              variantId: 'variant-1',
              skuCode: 'DT-KURTI-BLU-M',
              productName: 'Cotton kurti',
              variantLabel: 'Blue / M',
              barcode: null,
              sellerCompanyName: 'Dhaka Threads Ltd',
              locations: [],
            },
          ],
  }),
}));

vi.mock('@/components/easy/use-bin-lines', () => ({
  useBinLines: (binId: string) => ({
    isError: binId === 'not-a-shelf',
    isSuccess: binId !== '' && binId !== 'not-a-shelf',
    data:
      binId === 'bin-1'
        ? {
            items: [
              {
                stockLevelId: 'sl-1',
                sellerId: 'seller-1',
                sellerName: 'Dhaka Threads Ltd',
                variantId: 'variant-1',
                productName: 'Cotton kurti',
                skuCode: 'DT-KURTI-BLU-M',
                variantLabel: 'Blue / M',
                batchId: 'batch-1',
                batchCode: 'B-2611-A',
                qtyOnHand: 40,
              },
              {
                stockLevelId: 'sl-2',
                sellerId: 'seller-2',
                sellerName: 'Other Co',
                variantId: 'variant-2',
                productName: 'Jute bag',
                skuCode: 'OC-BAG',
                variantLabel: null,
                batchId: 'batch-2',
                batchCode: 'B-2610-C',
                qtyOnHand: 5,
              },
            ],
          }
        : undefined,
  }),
}));

import {
  BatchPick,
  BinPick,
  ClientPick,
  OrderPick,
  ProductPick,
  RemittancePick,
  StaffPick,
  StorePick,
} from '@/components/easy/id-picks';

const typed = <input aria-label="typed id" />;

describe('pick by name', () => {
  it('client: choosing a name hands back its id, and the id field stays', async () => {
    state.may = true;
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ClientPick value="" onChange={onChange}>
        {typed}
      </ClientPick>,
    );
    await user.selectOptions(screen.getByLabelText(/^Client/), 'Dhaka Threads Ltd');
    expect(onChange).toHaveBeenCalledWith('seller-1');
    expect(screen.getByLabelText('typed id')).toBeTruthy();
  });

  it('client: without permission to read clients, only the id field is shown', () => {
    state.may = false;
    render(
      <ClientPick value="" onChange={vi.fn()}>
        {typed}
      </ClientPick>,
    );
    expect(screen.queryByLabelText(/^Client/)).toBeNull();
    expect(screen.getByLabelText('typed id')).toBeTruthy();
    state.may = true;
  });

  it('client: an id that is not in the list reads as typed by hand, not as blank', () => {
    render(
      <ClientPick value="someone-else" onChange={vi.fn()}>
        {typed}
      </ClientPick>,
    );
    const select = screen.getByLabelText(/^Client/) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe('Typed by hand');
  });

  it('shelf: waits for a warehouse, then lists its shelves by code', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <BinPick warehouseId="" value="" onChange={onChange}>
        {typed}
      </BinPick>,
    );
    expect((screen.getByLabelText(/^Shelf/) as HTMLSelectElement).disabled).toBe(true);
    rerender(
      <BinPick warehouseId="wh-1" value="" onChange={onChange}>
        {typed}
      </BinPick>,
    );
    await user.selectOptions(screen.getByLabelText(/^Shelf/), 'bin-1');
    expect(onChange).toHaveBeenCalledWith('bin-1');
  });

  it('product: searching and tapping a result hands back the product id', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductPick value="" onChange={onChange}>
        {typed}
      </ProductPick>,
    );
    await user.type(screen.getByLabelText(/^Find the product/), 'kurti');
    await user.click(screen.getByRole('button', { name: /Cotton kurti/ }));
    expect(onChange).toHaveBeenCalledWith('variant-1');
    expect(screen.getByLabelText('typed id')).toBeTruthy();
  });

  it('batch: lists what is on the shelf and hands back the batch and its line', async () => {
    const onChange = vi.fn();
    const onLine = vi.fn();
    const user = userEvent.setup();
    render(
      <BatchPick binId="bin-1" variantId="" value="" onChange={onChange} onLine={onLine}>
        {typed}
      </BatchPick>,
    );
    const select = screen.getByLabelText(/^Batch/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toContain(
      'B-2611-A · DT-KURTI-BLU-M · 40 on the shelf',
    );
    await user.selectOptions(select, 'batch-1');
    expect(onChange).toHaveBeenCalledWith('batch-1');
    expect(onLine.mock.calls[0]?.[0]).toMatchObject({
      sellerId: 'seller-1',
      variantId: 'variant-1',
    });
  });

  it('batch: with a product chosen, only that product’s batches are offered', () => {
    render(
      <BatchPick binId="bin-1" variantId="variant-2" value="" onChange={vi.fn()}>
        {typed}
      </BatchPick>,
    );
    const select = screen.getByLabelText(/^Batch/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'batch-2']);
  });

  it('batch: a typed id that is not a shelf leaves only the typed batch field', () => {
    render(
      <BatchPick binId="not-a-shelf" variantId="" value="" onChange={vi.fn()}>
        {typed}
      </BatchPick>,
    );
    expect(screen.queryByLabelText(/^Batch/)).toBeNull();
    expect(screen.getByLabelText('typed id')).toBeTruthy();
  });

  it('staff and member store: chosen by name, the id handed back', async () => {
    const onStaff = vi.fn();
    const onStore = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <StaffPick value="" onChange={onStaff}>
          {typed}
        </StaffPick>
        <StorePick value="" onChange={onStore}>
          <input aria-label="typed store id" />
        </StorePick>
      </>,
    );
    await user.selectOptions(screen.getByLabelText(/^Staff member/), 'staff-1');
    await user.selectOptions(
      screen.getByLabelText(/^Member store/),
      'Rupa Boutique · Dhaka Threads Ltd',
    );
    expect(onStaff).toHaveBeenCalledWith('staff-1');
    expect(onStore).toHaveBeenCalledWith('store-1');
    expect(screen.getByLabelText('typed store id')).toBeTruthy();
  });

  it('order: found by its number, shown with who it went to and its COD, id handed back', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OrderPick value="" onChange={onChange}>
        {typed}
      </OrderPick>,
    );
    await user.type(screen.getByLabelText(/^Find the order/), '10231');
    const result = await screen.findByRole('button', { name: /SD-10231/ });
    expect(result.textContent).toContain('Anita Rao');
    expect(result.textContent).toContain('1499.00');
    await user.click(result);
    expect(onChange).toHaveBeenCalledWith('order-1');
    expect(screen.getByLabelText('typed id')).toBeTruthy();
  });

  it('payout: offers only that client’s payouts, by date, amount and bank reference', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RemittancePick sellerId="seller-1" value="" onChange={onChange}>
        {typed}
      </RemittancePick>,
    );
    const select = screen.getByLabelText(/^Payout that paid this/) as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('BDT 16800.00') && l.includes('UTR2611130001'))).toBe(
      true,
    );
    expect(labels.some((l) => l.includes('NOT-THEIRS'))).toBe(false);
    await user.selectOptions(select, 'rem-1');
    expect(onChange).toHaveBeenCalledWith('rem-1');
  });

  it('payout: with no client to list for, only the typed field is shown', () => {
    render(
      <RemittancePick sellerId="" value="" onChange={vi.fn()}>
        {typed}
      </RemittancePick>,
    );
    expect(screen.queryByLabelText(/^Payout that paid this/)).toBeNull();
    expect(screen.getByLabelText('typed id')).toBeTruthy();
  });
});
