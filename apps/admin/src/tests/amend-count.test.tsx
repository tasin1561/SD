/**
 * Amend a counted line — `(authed)/warehouse/_components/amend-count.tsx`.
 *
 * The control is permission-gated (cosmetic, FE-2), requires a reason of at
 * least 10 characters, asks for an in-page confirmation, and when the server
 * refuses with RECEIPT_COUNT_ALREADY_BANKED shows the server's words
 * VERBATIM plus a link into the stock adjustment form (no dead end).
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmendCount } from '@/app/(authed)/warehouse/_components/amend-count';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

const PROPS = {
  receiptId: 'gr-1',
  lineId: 'l-1',
  skuCode: 'AVIATO-BLAC-GOLD',
  receivedQty: 0,
  damagedQty: 0,
  sellerId: 'seller-1',
  variantId: 'v-1',
  batchId: null,
} as const;

const KEY = 'inventory.goods_receipts.amend_count';

describe('AmendCount', () => {
  it('renders nothing without the amend_count permission', () => {
    renderWithProviders(<AmendCount {...PROPS} />, {
      identity: makeStaff(['OPS'], ['inventory.goods_receipts.manage']),
    });
    expect(screen.queryByRole('button', { name: /edit the counted quantity/i })).toBeNull();
  });

  it('offers the edit with the permission, tells the 10-character rule up front, and gates review on it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AmendCount {...PROPS} />, { identity: makeStaff(['OPS'], [KEY]) });
    await user.click(screen.getByRole('button', { name: /edit the counted quantity/i }));
    expect(screen.getByText(/at least 10 characters/i)).toBeTruthy();
    const review = screen.getByRole('button', { name: /review change/i });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/why is the count changing/i), 'recounted the carton');
    expect((review as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the PATCH after an in-page confirmation', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /\/lines\/l-1\/count$/, responses: [{ status: 200, body: { id: 'gr-1' } }] },
    ]);
    renderWithProviders(<AmendCount {...PROPS} />, {
      identity: makeStaff(['OPS'], [KEY]),
      fetchImpl,
    });
    await user.click(screen.getByRole('button', { name: /edit the counted quantity/i }));
    const received = screen.getByLabelText(/^received/i);
    await user.clear(received);
    await user.type(received, '10');
    await user.type(screen.getByLabelText(/why is the count changing/i), 'recounted the carton');
    await user.click(screen.getByRole('button', { name: /review change/i }));
    expect(screen.getByText(/overrides the physical count/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));
    await waitFor(() => {
      const call = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/lines/l-1/count'));
      expect(call).toBeTruthy();
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(String(init.body))).toEqual({
        receivedQty: 10,
        damagedQty: 0,
        reason: 'recounted the carton',
      });
    });
  });

  it('shows RECEIPT_COUNT_ALREADY_BANKED verbatim and links to a stock adjustment', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /\/lines\/l-1\/count$/,
        responses: [
          {
            status: 409,
            body: { code: 'RECEIPT_COUNT_ALREADY_BANKED', message: 'This count is already stock.' },
          },
        ],
      },
    ]);
    renderWithProviders(<AmendCount {...PROPS} />, {
      identity: makeStaff(['OPS'], [KEY]),
      fetchImpl,
    });
    await user.click(screen.getByRole('button', { name: /edit the counted quantity/i }));
    await user.type(screen.getByLabelText(/why is the count changing/i), 'recounted the carton');
    await user.click(screen.getByRole('button', { name: /review change/i }));
    await user.click(screen.getByRole('button', { name: /confirm and save/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      '[RECEIPT_COUNT_ALREADY_BANKED] This count is already stock.',
    );
    const link = screen.getByRole('link', { name: /adjust stock for AVIATO-BLAC-GOLD/i });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/inventory/adjustments?');
    expect(href).toContain('variantId=v-1');
    expect(href).toContain('sellerId=seller-1');
  });
});
