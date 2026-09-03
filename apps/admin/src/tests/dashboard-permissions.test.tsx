import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { DashboardView } from '@/app/(authed)/dashboard/_components/dashboard-view';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

/**
 * The dashboard shows what you may see, and asks for nothing else.
 *
 * ── THE BUG ──────────────────────────────────────────────────────────
 * This is the one page open to every staff member, and it fired all
 * eight of its queries regardless of who was looking. A call agent holds
 * `orders.view` and nothing else here, so they signed in and were served
 * their own landing page with a red "API 403 (INSUFFICIENT_PERMISSION):
 * Call agent does not hold: reports.view" across the bottom, plus two
 * tiles stuck as grey rectangles — a tile whose request had failed only
 * knew how to keep showing a skeleton.
 *
 * Nothing was broken. The server refused correctly, the error surfaced
 * verbatim as FE-2 requires, and the tile rendered its loading state
 * because it never got data. The page was simply asking for things its
 * viewer was never allowed to have and then displaying the refusal.
 *
 * ── WHY THE ASSERTION IS ON THE REQUESTS ─────────────────────────────
 * Hiding the section while still fetching would make a screenshot look
 * right and leave the 403 in the server log, so the check is that the
 * request was NEVER ISSUED. That is also the only version that stays
 * true if somebody later re-renders the section for a different reason.
 */

const REPORT_SUMMARY = {
  orders: {
    created: 10,
    confirmed: 8,
    confirmRate: 0.8,
    delivered: 6,
    deliveryRate: 0.6,
    rtoInitiated: 1,
    rtoRate: 0.1,
    rejectedNdr: 1,
    ndrRate: 0.1,
  },
  shipments: { dispatched: 7, avgDispatchHoursFromConfirm: 4.2 },
  wallet: {
    codCollected: '1000.00',
    chargesDebited: '200.00',
    remittancesPaid: '500.00',
    netOutstanding: '300.00',
  },
};

function mock() {
  return buildFetchMock([
    {
      match: /\/admin\/orders/,
      responses: Array.from({ length: 8 }, () => ({
        status: 200,
        body: { items: [], total: 3, page: 1, pageSize: 1 },
      })),
    },
    {
      match: /\/admin\/tickets/,
      responses: [{ status: 200, body: { items: [], total: 2, page: 1, pageSize: 1 } }],
    },
    {
      match: /\/admin\/withdrawal-requests/,
      responses: [{ status: 200, body: { items: [], total: 1, page: 1, pageSize: 1 } }],
    },
    { match: /\/admin\/reports/, responses: [{ status: 200, body: REPORT_SUMMARY }] },
  ]);
}

const urls = (f: ReturnType<typeof mock>): string[] => f.mock.calls.map((c) => String(c[0]));

describe('dashboard — permission gating', () => {
  it('a call agent issues NO request they would be refused', async () => {
    const fetchImpl = mock();
    renderWithProviders(<DashboardView />, {
      identity: makeStaff('CALL_AGENT' as never, ['orders.view', 'callcenter.work']),
      fetchImpl,
    });

    // The order tiles are theirs, so those do go out.
    await waitFor(() =>
      expect(urls(fetchImpl).some((u) => u.includes('/admin/orders'))).toBe(true),
    );

    const asked = urls(fetchImpl);
    expect(asked.filter((u) => u.includes('/admin/reports'))).toEqual([]);
    expect(asked.filter((u) => u.includes('/admin/tickets'))).toEqual([]);
    expect(asked.filter((u) => u.includes('/admin/withdrawal-requests'))).toEqual([]);
  });

  it('a call agent is not shown a refusal on their own landing page', async () => {
    renderWithProviders(<DashboardView />, {
      identity: makeStaff('CALL_AGENT' as never, ['orders.view']),
      fetchImpl: mock(),
    });

    await waitFor(() => expect(screen.getByText('Awaiting call')).toBeInTheDocument());
    expect(screen.queryByText(/403/)).not.toBeInTheDocument();
    expect(screen.queryByText(/INSUFFICIENT_PERMISSION/)).not.toBeInTheDocument();
    // And the panels that are not theirs are absent rather than empty.
    expect(screen.queryByText(/performance & fulfilment/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Open tickets')).not.toBeInTheDocument();
    expect(screen.queryByText('Withdrawal requests')).not.toBeInTheDocument();
  });

  it('a super admin still gets the whole page', async () => {
    const fetchImpl = mock();
    renderWithProviders(<DashboardView />, {
      identity: makeStaff('SUPER_ADMIN' as never, [
        'orders.view',
        'tickets.view',
        'money.view',
        'reports.view',
      ]),
      fetchImpl,
    });

    // `findBy` per tile: each has its own query, and a tile renders a
    // skeleton until its own data lands — so a single waitFor on the
    // first one to resolve would assert against the others mid-flight.
    expect(await screen.findByText(/performance & fulfilment/i)).toBeInTheDocument();
    expect(await screen.findByText('Open tickets')).toBeInTheDocument();
    expect(await screen.findByText('Withdrawal requests')).toBeInTheDocument();
    await waitFor(() =>
      expect(urls(fetchImpl).some((u) => u.includes('/admin/reports'))).toBe(true),
    );
  });

  it('somebody with none of these is told so, rather than shown an empty page', async () => {
    renderWithProviders(<DashboardView />, {
      identity: makeStaff('WAREHOUSE_STAFF' as never, ['warehouse.pick']),
      fetchImpl: mock(),
    });
    expect(await screen.findByText(/no permissions that show anything here/i)).toBeInTheDocument();
  });
});
