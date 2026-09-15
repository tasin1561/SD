/**
 * The seller's view of a reseller store's wallet (RS-6).
 *
 * Two things this pins, both found by the 2026-09-15 UI audit:
 *   - the ledger is PAGED. It used to ask for `limit=100` and stop, so
 *     every movement past the hundredth was unreachable; "Show older"
 *     now asks for the page before the last row it has (`before=<id>`).
 *   - changing how far below zero a store may go is the seller's money at
 *     risk, so Save asks first and only the confirmation PATCHes.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@skydrop/ui/components';
import type { ResellerStoreDetail } from '@/lib/reseller-store-hooks';
import { StoreWalletSection } from '../app/(authed)/reseller-stores/[storeId]/_components/store-wallet-section';
import { buildFetchMock, makeSeller, renderWithProviders } from './helpers';

const STORE = {
  id: '01900000-0000-7000-8000-000000000001',
  name: 'Kurta Corner',
  displayName: null,
  status: 'ACTIVE',
  walletManagedBy: 'SELLER',
} as unknown as ResellerStoreDetail;

const SUMMARY = {
  storeId: STORE.id,
  walletManagedBy: 'SELLER',
  balanceInr: '500.00',
  withdrawableInr: null,
  negativeLimit: { ownInr: '1000.00', capInr: '25000.00', effectiveInr: '1000.00' },
  pendingTopups: { count: 0, amountInr: '0.00' },
  pendingWithdrawals: { count: 0, amountInr: '0.00' },
};

function entry(id: string, linkedOrderId: string | null = null) {
  return {
    id,
    direction: 'SELLER_TOPUP',
    amountInr: '100.00',
    runningBalanceAfterInr: '500.00',
    linkedOrderId,
    note: null,
    createdAt: '2026-09-10T10:00:00.000Z',
  };
}

const identity = makeSeller({ permissions: ['stores.wallet', 'stores.manage'] });

afterEach(() => vi.unstubAllGlobals());

describe('reseller store wallet section', () => {
  it('pages the ledger: "Show older" asks for the entries before the last one shown', async () => {
    const fetchImpl = buildFetchMock([
      { match: /\/wallet$/, responses: [{ status: 200, body: SUMMARY }] },
      {
        match: /\/wallet\/entries\?limit=50$/,
        responses: [
          {
            status: 200,
            body: { items: [entry('e-3', 'order-9'), entry('e-2')], nextCursor: 'e-2' },
          },
        ],
      },
      {
        match: /\/wallet\/entries\?limit=50&before=e-2$/,
        responses: [{ status: 200, body: { items: [entry('e-1')], nextCursor: null } }],
      },
    ]);
    renderWithProviders(
      <Toaster>
        <StoreWalletSection store={STORE} />
      </Toaster>,
      { identity, fetchImpl },
    );

    expect(await screen.findByText('Showing the latest 2 movements.')).toBeInTheDocument();
    // A movement about an order leads to it.
    expect(screen.getByRole('link', { name: 'See the order' })).toHaveAttribute(
      'href',
      '/orders/order-9',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('Showing all 3 movements.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
    expect(
      fetchImpl.mock.calls.some(([u]) => String(u).endsWith('entries?limit=50&before=e-2')),
    ).toBe(true);
  });

  it('asks before changing the negative limit, and only the confirmation saves it', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /\/wallet$/,
        responses: [
          { status: 200, body: SUMMARY },
          { status: 200, body: SUMMARY },
        ],
      },
      {
        match: /\/wallet\/entries/,
        responses: [
          { status: 200, body: { items: [], nextCursor: null } },
          { status: 200, body: { items: [], nextCursor: null } },
        ],
      },
      {
        match: /\/wallet\/negative-limit$/,
        responses: [
          {
            status: 200,
            body: { ownInr: '2000.00', capInr: '25000.00', effectiveInr: '2000.00' },
          },
        ],
      },
    ]);
    renderWithProviders(
      <Toaster>
        <StoreWalletSection store={STORE} />
      </Toaster>,
      { identity, fetchImpl },
    );

    // The field's own help button carries the same words in its aria-label.
    const input = await screen.findByLabelText(/How far below zero it may go/, {
      selector: 'input',
    });
    fireEvent.change(input, { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The dialog is up and nothing has been sent yet.
    expect(
      await screen.findByText('Change how far below zero the store may go?'),
    ).toBeInTheDocument();
    const patched = (): boolean =>
      fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/wallet/negative-limit'));
    expect(patched()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Change the limit' }));
    await waitFor(() => expect(patched()).toBe(true));
  });
});
