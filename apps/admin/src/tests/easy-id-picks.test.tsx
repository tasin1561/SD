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

import { BinPick, ClientPick, ProductPick } from '@/components/easy/id-picks';

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
});
