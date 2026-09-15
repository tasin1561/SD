/**
 * RS-6 — approving a store's withdrawal is a money decision, so the
 * button ASKS first (naming the amount, the store and the payee) and only
 * the confirm posts. The server's verdict on the approve is shown
 * verbatim (FE-2).
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResellerStoreWalletsIndex } from '@/app/(authed)/reseller-store-wallets/_components/reseller-store-wallets-index';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/reseller-store-wallets',
}));

const REQUEST_ID = '019fad84-7acd-754e-8ee4-43cf858fed11';

const withdrawal = {
  id: REQUEST_ID,
  storeId: '019fad84-7acd-754e-8ee4-43cf858fed22',
  storeName: 'Kolkata Kurtis',
  sellerId: '019fad84-7acd-754e-8ee4-43cf858fed33',
  sellerCompanyName: 'Menev Store',
  amountInr: '1250.50',
  status: 'PENDING',
  payeeName: 'Rina Das',
  payeeAccountNumber: '001122334455',
  payeeIfsc: 'HDFC0001234',
  payeeBankName: 'HDFC Bank',
  note: null,
  rejectionReason: null,
  paidFromLabel: null,
  bankReference: null,
  paidAt: null,
  createdAt: '2026-09-14T10:00:00.000Z',
};

const PERMS = ['money.view', 'money.withdrawals.review', 'money.topups.review'];

describe('store withdrawal approve asks before it posts', () => {
  it('the row button opens a confirm naming amount, store and payee; only the confirm posts', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /\/topups\?/, responses: [{ status: 200, body: [] }] },
      { match: /\/withdrawals\?/, responses: [{ status: 200, body: [withdrawal] }] },
      {
        match: /\/approve$/,
        responses: [{ status: 200, body: { ...withdrawal, status: 'APPROVED' } }],
      },
    ]);
    renderWithProviders(<ResellerStoreWalletsIndex />, {
      fetchImpl,
      identity: makeStaff(undefined, PERMS),
    });

    await user.click(await screen.findByRole('button', { name: /^approve$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Kolkata Kurtis/)).toBeInTheDocument();
    expect(within(dialog).getByText(/₹1,250\.50/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Rina Das/)).toBeInTheDocument();
    // Nothing posted yet.
    expect(fetchImpl.mock.calls.some((c) => /\/approve$/.test(String(c[0])))).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: /approve the withdrawal/i }));
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some((c) =>
          new RegExp(`/withdrawals/${REQUEST_ID}/approve$`).test(String(c[0])),
        ),
      ).toBe(true),
    );
  });

  it('a refusal from the server renders verbatim inside the confirm', async () => {
    const user = userEvent.setup();
    const rejection = {
      code: 'STORE_WITHDRAWAL_EXCEEDS_WITHDRAWABLE',
      message: 'The store can withdraw at most ₹900.00 now.',
    };
    const fetchImpl = buildFetchMock([
      { match: /\/topups\?/, responses: [{ status: 200, body: [] }] },
      { match: /\/withdrawals\?/, responses: [{ status: 200, body: [withdrawal] }] },
      { match: /\/approve$/, responses: [{ status: 409, body: rejection }] },
    ]);
    renderWithProviders(<ResellerStoreWalletsIndex />, {
      fetchImpl,
      identity: makeStaff(undefined, PERMS),
    });
    await user.click(await screen.findByRole('button', { name: /^approve$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /approve the withdrawal/i }));
    expect(
      await screen.findByText(`[${rejection.code}] ${rejection.message}`, { exact: false }),
    ).toBeInTheDocument();
  });
});
