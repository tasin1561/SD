/**
 * The header search — `(authed)/_components/order-omnisearch.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. Somebody holding an
 * AWB types or scans it here: the search waits 250 ms after the last
 * keystroke before asking once; Escape closes the results; Enter goes
 * straight to the answer ONLY when there is exactly one (one order and no
 * ticket, or one ticket and no order); a click outside closes. A restyle
 * must not change the timing, the keys or when Enter navigates.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }) }));

import { OrderOmnisearch } from '@/app/(authed)/_components/order-omnisearch';
import { makeStaff, renderWithProviders } from './helpers';
import { requestsTo, scanFetch, type ScanRoute } from './scan-fetch';

function order(id: string, orderNumber: string): Record<string, unknown> {
  return {
    id,
    orderNumber,
    status: 'CONFIRMED',
    recipientName: 'Asha Rao',
    recipientPhoneE164: '+919800000000',
  };
}

function page(items: readonly unknown[]): Record<string, unknown> {
  return { items, total: items.length, page: 1, pageSize: 8 };
}

const ORDERS_ONE: ScanRoute = {
  match: /\/api\/admin\/orders\?/,
  method: 'GET',
  reply: { status: 200, body: page([order('o-1', 'SD-2026-26-000001')]) },
};
const ORDERS_TWO: ScanRoute = {
  match: /\/api\/admin\/orders\?/,
  method: 'GET',
  reply: {
    status: 200,
    body: page([order('o-1', 'SD-2026-26-000001'), order('o-2', 'SD-2026-26-000002')]),
  },
};

function renderSearch(routes: ScanRoute[]): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<OrderOmnisearch />, {
    identity: makeStaff(undefined, ['orders.view', 'tickets.view']),
    fetchImpl: scanFetch(routes),
  });
}

function box(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Find an order or ticket' }) as HTMLInputElement;
}

afterEach(() => {
  vi.useRealTimers();
  nav.push.mockReset();
});

describe('omnisearch — debounce', () => {
  // order-omnisearch.tsx:49-53, :64 — one request, 250 ms after the LAST keystroke.
  it('waits 250 ms after the last keystroke, then asks once with the final term', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = renderSearch([ORDERS_ONE]);
    fireEvent.change(box(), { target: { value: 'SD' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(box(), { target: { value: 'SD-20' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    fireEvent.change(box(), { target: { value: 'SD-2026' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(requestsTo(fetchImpl, /\/api\/admin\/orders/)).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    const asked = requestsTo(fetchImpl, /\/api\/admin\/orders/);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe('/api/admin/orders?search=SD-2026&pageSize=8');
  });

  // :64 — fewer than two characters never asks.
  it('never asks for a one-character term', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = renderSearch([ORDERS_ONE]);
    fireEvent.change(box(), { target: { value: 'S' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(requestsTo(fetchImpl, /\/api\/admin\/orders/)).toEqual([]);
  });
});

describe('omnisearch — keys', () => {
  // :127-131 — exactly one order and no ticket: Enter navigates to it.
  it('Enter with exactly one order navigates to it', async () => {
    const user = userEvent.setup();
    renderSearch([ORDERS_ONE]);
    await user.type(box(), 'SD-2026-26-000001');
    await screen.findByText('SD-2026-26-000001');
    await user.keyboard('{Enter}');
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('/orders/o-1');
    // go() clears the term.
    expect(box().value).toBe('');
  });

  // :127-128 — exactly one ticket and no order: Enter navigates to the ticket.
  it('Enter with exactly one ticket (and no order) navigates to the ticket', async () => {
    const user = userEvent.setup();
    renderSearch([
      { match: /\/api\/admin\/orders\?/, method: 'GET', reply: { status: 200, body: page([]) } },
      {
        match: /\/api\/admin\/tickets/,
        method: 'GET',
        reply: {
          status: 200,
          body: page([{ id: 't-1', ticketNumber: 'TK-2026-000003', subject: 'Damaged unit' }]),
        },
      },
    ]);
    await user.type(box(), 'TK-2026-000003');
    await screen.findByText('Damaged unit');
    await user.keyboard('{Enter}');
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('/tickets/t-1');
  });

  // :129 — several results: Enter does nothing; the list is the answer.
  it('Enter with several results does nothing', async () => {
    const user = userEvent.setup();
    renderSearch([ORDERS_TWO]);
    await user.type(box(), 'SD-2026');
    await screen.findByText('SD-2026-26-000002');
    await user.keyboard('{Enter}');
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByText('SD-2026-26-000001')).toBeInTheDocument();
  });

  // :124 — Escape closes the results.
  it('Escape closes the results', async () => {
    const user = userEvent.setup();
    renderSearch([ORDERS_TWO]);
    await user.type(box(), 'SD-2026');
    await screen.findByText('SD-2026-26-000001');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('SD-2026-26-000001')).not.toBeInTheDocument());
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('omnisearch — click outside', () => {
  // :55-62 — a mousedown outside the box closes; one inside does not.
  it('a mousedown outside closes the results; inside keeps them', async () => {
    const user = userEvent.setup();
    renderSearch([ORDERS_TWO]);
    await user.type(box(), 'SD-2026');
    await screen.findByText('SD-2026-26-000001');

    fireEvent.mouseDown(box());
    expect(screen.getByText('SD-2026-26-000001')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('SD-2026-26-000001')).not.toBeInTheDocument());
  });
});
