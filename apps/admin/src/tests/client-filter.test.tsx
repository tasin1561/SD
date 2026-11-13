/**
 * The Client filter on admin lists. The UI word is Client; the query
 * param is `sellerId`. It needs `sellers.view`, a different permission
 * from the one that opens the page, so without it the control must be
 * absent rather than an empty dropdown.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueIndex } from '@/app/(authed)/call-center/queue/_components/queue-index';
import { TicketsIndex } from '@/app/(authed)/tickets/_components/tickets-index';
import { makeStaff, renderWithProviders } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Needs a toast provider the filter does not care about.
vi.mock('@/app/(authed)/call-center/queue/_components/force-outcome-panel', () => ({
  ForceOutcomePanel: () => null,
}));

const SELLERS = {
  items: [
    { id: 'sel-acme', companyName: 'Acme Traders' },
    { id: 'sel-bolt', companyName: 'Bolt Exports' },
  ],
  total: 2,
  page: 1,
  pageSize: 100,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers by URL, indefinitely — the page refetches on every filter change. */
function routedFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/admin/sellers')) return json(SELLERS);
    if (url.includes('/api/admin/call-queue/stats')) {
      return json({ byStatus: {}, openTotal: 0, assignedByAgent: [] });
    }
    if (url.includes('/api/admin/call-queue')) {
      return json({
        items: [
          {
            id: 'q1',
            orderId: 'o1',
            status: 'PENDING',
            assignedAgentId: null,
            assignedAt: null,
            availableAt: '2020-01-01T00:00:00.000Z',
            scheduledAttempts: 0,
            attemptsLogged: 0,
            attemptsCounting: 0,
            maxAttempts: 6,
            createdAt: '2020-01-01T00:00:00.000Z',
            order: { orderNumber: 'SD-1', sellerId: 'sel-acme', status: 'PENDING_CONFIRMATION' },
            agent: null,
          },
        ],
        total: 60,
        page: 1,
        pageSize: 25,
      });
    }
    if (url.includes('/api/admin/agents')) return json([]);
    if (url.includes('/api/admin/tickets')) {
      return json({ items: [], total: 0, page: 1, pageSize: 25 });
    }
    return json({});
  });
}

function queueCalls(fetchImpl: ReturnType<typeof vi.fn>): URL[] {
  return fetchImpl.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => /\/api\/admin\/call-queue\?/.test(u))
    .map((u) => new URL(u, 'http://x'));
}

const WITH_VIEW = makeStaff(['SUPER_ADMIN'], ['callcenter.queue.manage', 'sellers.view']);
const WITHOUT_VIEW = makeStaff(['CALL_SUPERVISOR'], ['callcenter.queue.manage']);

describe('Client filter - call queue', () => {
  it('is labelled Client and sends sellerId, keeping status and agent', async () => {
    const fetchImpl = routedFetch();
    renderWithProviders(<QueueIndex />, { identity: WITH_VIEW, fetchImpl });

    const select = await screen.findByRole('combobox', { name: /client/i });
    await screen.findByRole('option', { name: 'Acme Traders' });
    await userEvent.selectOptions(select, 'sel-acme');

    await waitFor(() => {
      const last = queueCalls(fetchImpl).at(-1);
      expect(last?.searchParams.get('sellerId')).toBe('sel-acme');
      expect(last?.searchParams.get('status')).toBe('OPEN');
    });
    // The two existing filters are still there.
    // The status filter is a row of pills now (owner, 2026-11-13), still labelled Status.
    expect(screen.getByRole('group', { name: /^status$/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^agent$/i })).toBeInTheDocument();
  });

  it('resets to page 1 when the client changes', async () => {
    const fetchImpl = routedFetch();
    renderWithProviders(<QueueIndex />, { identity: WITH_VIEW, fetchImpl });

    await userEvent.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => {
      expect(queueCalls(fetchImpl).at(-1)?.searchParams.get('page')).toBe('2');
    });

    await screen.findByRole('option', { name: 'Bolt Exports' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /client/i }), 'sel-bolt');

    await waitFor(() => {
      const last = queueCalls(fetchImpl).at(-1);
      expect(last?.searchParams.get('sellerId')).toBe('sel-bolt');
      expect(last?.searchParams.get('page')).toBe('1');
    });
  });

  it('does not draw the control, or ask for clients, without sellers.view', async () => {
    const fetchImpl = routedFetch();
    renderWithProviders(<QueueIndex />, { identity: WITHOUT_VIEW, fetchImpl });

    await screen.findByRole('combobox', { name: /^agent$/i });
    expect(screen.queryByRole('combobox', { name: /client/i })).toBeNull();
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes('/api/admin/sellers'))).toBe(
      false,
    );
  });
});

describe('Client filter - tickets', () => {
  it('sends sellerId and is absent without sellers.view', async () => {
    const fetchImpl = routedFetch();
    const view = makeStaff(['SUPER_ADMIN'], ['tickets.view', 'sellers.view']);
    const first = renderWithProviders(<TicketsIndex />, { identity: view, fetchImpl });
    await screen.findByRole('option', { name: 'Acme Traders' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /client/i }), 'sel-acme');
    await waitFor(() => {
      const url = fetchImpl.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/admin/tickets?'))
        .at(-1);
      expect(new URL(url ?? '', 'http://x').searchParams.get('sellerId')).toBe('sel-acme');
    });
    first.unmount();

    renderWithProviders(<TicketsIndex />, {
      identity: makeStaff(['SUPER_ADMIN'], ['tickets.view']),
      fetchImpl: routedFetch(),
    });
    await screen.findByRole('combobox', { name: /^status$/i });
    expect(screen.queryByRole('combobox', { name: /client/i })).toBeNull();
  });
});
