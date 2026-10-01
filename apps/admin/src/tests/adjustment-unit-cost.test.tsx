/**
 * Raising a stock adjustment on a batch with no recorded cost.
 *
 * The value impact decides whether a correction needs a second person
 * (INV-8) and it is `unitCostInr` × quantity, taken from the line if it
 * carries one and otherwise from the batch. A batch with neither is
 * refused outright. A batch with no cost is an ORDINARY state — on the
 * demo box 62 of 64 carried none — so until this field existed, every
 * "Adjust" link on a bin's contents led to a form that could not be
 * submitted and a verdict naming a field nobody could see.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@skydrop/ui/app/toast';

const state = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/lib/inventory-hooks', () => ({
  useCreateAdjustment: () => ({
    isPending: false,
    isError: false,
    isSuccess: false,
    mutateAsync: state.mutateAsync,
  }),
}));
vi.mock('@/lib/use-permission', () => ({ usePermission: () => true }));

import { NewAdjustmentPanel } from '../app/(authed)/inventory/adjustments/_components/new-adjustment-panel';

const PREFILL = {
  sellerId: 'seller-1',
  variantId: 'variant-1',
  binId: 'bin-1',
  batchId: 'batch-1',
  reasonCode: 'RETURNED_TO_SELLER',
};

function panel() {
  return render(
    <ToastProvider>
      <NewAdjustmentPanel prefill={PREFILL} />
    </ToastProvider>,
  );
}

describe('raising an adjustment', () => {
  it('offers a unit cost, and says when it is needed', () => {
    panel();
    const field = screen.getByLabelText(/^Unit cost/);
    expect(field).toBeTruthy();
    expect(screen.getByText(/Only needed when the batch has no recorded cost/)).toBeTruthy();
  });

  it('sends the unit cost on the line when one is typed', async () => {
    state.mutateAsync.mockResolvedValue({ status: 'EXECUTED' });
    const user = userEvent.setup();
    panel();

    await user.type(screen.getByLabelText(/^Quantity/), '1');
    await user.type(screen.getByLabelText(/^Unit cost/), '2400');
    await user.click(screen.getByRole('button', { name: /Raise adjustment/ }));

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalled());
    const sent = state.mutateAsync.mock.calls[0]?.[0] as {
      lines: ReadonlyArray<{ unitCostInr?: number; qtyChange: number }>;
    };
    expect(sent.lines[0]?.unitCostInr).toBe(2400);
    // The sign comes from the direction, never from what was typed.
    expect(sent.lines[0]?.qtyChange).toBe(-1);
  });

  it('leaves the cost off the line when the field is empty, so the batch decides', async () => {
    state.mutateAsync.mockReset();
    state.mutateAsync.mockResolvedValue({ status: 'PENDING' });
    const user = userEvent.setup();
    panel();

    await user.type(screen.getByLabelText(/^Quantity/), '2');
    await user.click(screen.getByRole('button', { name: /Raise adjustment/ }));

    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalled());
    const sent = state.mutateAsync.mock.calls[0]?.[0] as {
      lines: ReadonlyArray<{ unitCostInr?: number }>;
    };
    expect('unitCostInr' in (sent.lines[0] ?? {})).toBe(false);
  });
});
