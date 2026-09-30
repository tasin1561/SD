/**
 * The return fee a seller is shown must be THEIR fee.
 *
 * Both return dialogs carried the figure in their copy. `₹200` is right
 * for the seeded default of `pricing.customer_return_fee` and wrong for
 * any seller who negotiated one — and the fee is seller-overridable with
 * its own currency beside it (PRC-8), so the copy is wrong for everybody
 * the moment the global default moves. The delivery fee's default moved
 * from ₹200 to ৳200 on 2026-09-20 and nothing on screen changed.
 *
 * The send-back half was worse: it said "a return fee applies" and named
 * no figure at all, while charging a DIFFERENT fee (the RTO fee, not the
 * customer-return one) — so a seller who read the ₹200 in one dialog and
 * pressed the other paid something else.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@skydrop/ui/app/toast';
import type { SellerFeeView } from '@/lib/api-hooks';

const state = vi.hoisted(() => ({
  fees: [] as SellerFeeView[],
}));

vi.mock('@/lib/api-hooks', () => ({
  useRequestReturn: () => ({ isPending: false, isError: false, error: null, mutate: vi.fn() }),
  useSellerFees: () => ({ isLoading: false, data: { items: state.fees } }),
}));

vi.mock('@/lib/ops-hooks', () => ({
  useDeliveryActions: () => ({ data: { items: [] } }),
  useCallHistory: () => ({ data: { items: [] } }),
  useRequestDeliveryAction: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { RequestReturnDialog } from '../app/(authed)/orders/_components/request-return-dialog';
import { DeliveryTroublePanel } from '../app/(authed)/orders/[id]/_components/delivery-trouble-panel';

function fee(kind: SellerFeeView['kind'], over: Partial<SellerFeeView> = {}): SellerFeeView {
  return {
    kind,
    amountInr: '350.00',
    agreedAmount: '350.00',
    agreedCurrency: 'INR',
    fxRate: null,
    fxRatePair: null,
    ...over,
  };
}

describe('the return fee on screen is read, not typed', () => {
  it("shows THIS seller's customer-return fee, not a literal in the copy", () => {
    state.fees = [fee('customerReturn', { amountInr: '350.00', agreedAmount: '350.00' })];
    render(
      <ToastProvider>
        <RequestReturnDialog orderId="o1" orderNumber="SD-2026-26-000001" open onClose={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.getByText(/₹\s*350/)).toBeTruthy();
    // The old literal must be gone, or a seller on ₹350 reads both.
    expect(screen.queryByText(/₹\s*200/)).toBeNull();
  });

  it('names the fee as AGREED when it is not rupees, beside the rupee figure', () => {
    state.fees = [
      fee('customerReturn', { amountInr: '162.60', agreedAmount: '200.00', agreedCurrency: 'BDT' }),
    ];
    render(
      <ToastProvider>
        <RequestReturnDialog orderId="o1" orderNumber="SD-2026-26-000001" open onClose={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.getByText(/₹\s*162\.60/)).toBeTruthy();
    expect(screen.getByText(/৳\s*200/)).toBeTruthy();
  });

  it('says so rather than showing a zero when the fee cannot be priced', () => {
    state.fees = [
      fee('customerReturn', { amountInr: null, agreedAmount: '200.00', agreedCurrency: 'BDT' }),
    ];
    render(
      <ToastProvider>
        <RequestReturnDialog orderId="o1" orderNumber="SD-2026-26-000001" open onClose={vi.fn()} />
      </ToastProvider>,
    );
    // A zero would promise a free return and then take money for it.
    expect(screen.queryByText(/₹\s*0\.00/)).toBeNull();
    expect(screen.getByText(/৳\s*200/)).toBeTruthy();
  });

  it("puts the RTO fee's own figure on the send-back choice", async () => {
    state.fees = [
      fee('return', { amountInr: '24.39', agreedAmount: '30.00', agreedCurrency: 'BDT' }),
    ];
    render(
      <ToastProvider>
        <DeliveryTroublePanel
          orderId="o1"
          orderNumber="SD-2026-26-000002"
          orderStatus="OUT_FOR_DELIVERY"
          open
          onOpenChange={vi.fn()}
        />
      </ToastProvider>,
    );
    // The hint belongs to the SELECTED choice, and RTO is not the
    // default — so the figure is only on screen once it is chosen,
    // which is exactly when a seller is about to spend it.
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByLabelText(/What would you like/), { target: { value: 'RTO' } });
    const said = dialog.textContent ?? '';
    expect(said).toMatch(/return fee is ₹24\.39/);
    expect(said).toMatch(/agreed as ৳30\.00/);
    // The old figure-less prose must be gone on this choice.
    expect(said).not.toMatch(/a return fee applies/);
  });
});
