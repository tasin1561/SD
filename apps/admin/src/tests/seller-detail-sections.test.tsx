/**
 * The two seller-detail sections that had an endpoint and no screen.
 *
 *  - CACC-1 courier links: weighted per-seller routing existed from R1
 *    and could not be created through any interface, so every seller
 *    rode the courier's default account whatever had been agreed.
 *  - Bulk-close of a seller's call queue: the hook sent only `sellerId`,
 *    so every call was a 400 nobody ever saw. The reason it now carries
 *    is what `BulkDequeueDto` requires and what the audit row records —
 *    pinned here, because a missing field is invisible until somebody
 *    presses the button.
 *
 * FE-2 throughout: the weight bounds, the permission and the DTO are the
 * server's, and its refusal is rendered exactly as it came.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SellerCourierLinksSection } from '@/app/(authed)/sellers/_components/seller-courier-links-section';
import { BulkDequeuePanel } from '@/app/(authed)/sellers/_components/bulk-dequeue-panel';
import { buildFetchMock, renderWithProviders, makeStaff } from './helpers';

const SELLER = '019fad84-7acd-754e-8ee4-43cf858fed99';
const ACCOUNT = '019fad84-7acd-754e-8ee4-43cf858fee01';

const ACCOUNTS = [
  {
    id: ACCOUNT,
    courierCode: 'delhivery',
    environment: 'PRODUCTION',
    label: 'Delhivery One',
    isDefault: true,
    isActive: true,
    pickupLocationName: null,
    payoutBankAccountId: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const LINKS = [
  {
    id: 'link-1',
    sellerId: SELLER,
    courierAccountId: ACCOUNT,
    distributionWeight: 100,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

function linksFetch(deleteResponse?: {
  status: number;
  body?: unknown;
}): ReturnType<typeof buildFetchMock> {
  return buildFetchMock([
    ...(deleteResponse
      ? [{ match: /\/sellers\/[^/]+\/courier-accounts\/[^/?]+$/, responses: [deleteResponse] }]
      : []),
    { match: /\/sellers\/[^/]+\/courier-accounts$/, responses: [{ status: 200, body: LINKS }] },
    { match: /\/api\/admin\/courier-accounts/, responses: [{ status: 200, body: ACCOUNTS }] },
  ]);
}

describe('seller ↔ courier-account links (CACC-1)', () => {
  it('shows which account carries this seller, and its share', async () => {
    renderWithProviders(<SellerCourierLinksSection sellerId={SELLER} />, {
      fetchImpl: linksFetch(),
      identity: makeStaff(undefined, ['courier.accounts.view', 'sellers.courier_links.manage']),
    });

    expect(await screen.findByText('Delhivery One')).toBeInTheDocument();
    // The only active link carries everything.
    expect(await screen.findByText('100%')).toBeInTheDocument();
  });

  it('a refusal from the SERVER renders VERBATIM, after the request was made', async () => {
    const user = userEvent.setup();
    const rejection = {
      code: 'COURIER_ACCOUNT_LINK_NOT_FOUND',
      message: 'That link has already been removed.',
    };
    const fetchImpl = linksFetch({ status: 404, body: rejection });

    renderWithProviders(<SellerCourierLinksSection sellerId={SELLER} />, {
      fetchImpl,
      identity: makeStaff(undefined, ['courier.accounts.view', 'sellers.courier_links.manage']),
    });

    await user.click(await screen.findByRole('button', { name: /^unlink$/i }));
    // The confirm dialog carries its own Unlink button.
    const buttons = await screen.findAllByRole('button', { name: /^unlink$/i });
    await user.click(buttons[buttons.length - 1] as HTMLElement);

    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => /courier-accounts\/[^/?]+$/.test(String(c[0])))).toBe(
        true,
      );
    });
    expect(
      await screen.findByText(`[${rejection.code}] ${rejection.message}`, { exact: false }),
    ).toBeInTheDocument();
  });

  it('renders nothing for somebody who may not read courier accounts', () => {
    // Cosmetic (FE-2): the controller's class gate refuses them anyway —
    // this only avoids showing a section whose every query would 403.
    renderWithProviders(<SellerCourierLinksSection sellerId={SELLER} />, {
      fetchImpl: linksFetch(),
      identity: makeStaff(undefined, ['sellers.view']),
    });
    expect(screen.queryByText(/courier accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Delhivery One')).not.toBeInTheDocument();
  });
});

describe("bulk-closing a seller's call queue", () => {
  it('sends the reason the DTO requires, with the seller', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /\/admin\/call-queue\/bulk-dequeue$/,
        responses: [{ status: 200, body: { sellerId: SELLER, dequeuedOrders: 3 } }],
      },
    ]);

    renderWithProviders(<BulkDequeuePanel sellerId={SELLER} sellerName="Menev Store" />, {
      fetchImpl,
      identity: makeStaff(undefined, ['callcenter.queue.manage']),
    });

    await user.type(
      screen.getByLabelText(/reason/i),
      'Seller paused trading until their stock arrives',
    );
    await user.click(screen.getByRole('button', { name: /close all open queue entries/i }));
    await user.click(await screen.findByRole('button', { name: /^close entries$/i }));

    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => /bulk-dequeue$/.test(String(c[0])))).toBe(true);
    });
    const call = fetchImpl.mock.calls.find((c) => /bulk-dequeue$/.test(String(c[0])));
    const init = call?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({
      sellerId: SELLER,
      reason: 'Seller paused trading until their stock arrives',
    });
  });

  it('is not offered to somebody who cannot manage the queue', () => {
    renderWithProviders(<BulkDequeuePanel sellerId={SELLER} sellerName="Menev Store" />, {
      fetchImpl: buildFetchMock([]),
      identity: makeStaff(undefined, ['sellers.view']),
    });
    expect(screen.queryByText(/call queue/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /close all open queue entries/i }),
    ).not.toBeInTheDocument();
  });
});
