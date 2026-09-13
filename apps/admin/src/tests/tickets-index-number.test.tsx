/**
 * The admin ticket queue shows each ticket's NUMBER (TK-…) — what a seller
 * quotes to us — and searches by it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TicketView } from '@/lib/ops-hooks';

const state = vi.hoisted(() => ({ calls: [] as unknown[], rows: [] as unknown[] }));

vi.mock('@/lib/ops-hooks', () => ({
  useTicketsList: (query: unknown) => {
    state.calls.push(query);
    return {
      isLoading: false,
      isError: false,
      data: { items: state.rows, total: state.rows.length, page: 1, pageSize: 25 },
      refetch: vi.fn(),
    };
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { TicketsIndex } from '../app/(authed)/tickets/_components/tickets-index';

const ROW = {
  id: 'ticket-1',
  ticketNumber: 'TK-2026-000003',
  openedBy: 'STAFF',
  ticketType: 'SCRAP_DAMAGE',
  status: 'OPEN',
  sellerId: 'seller-1',
  orderId: null,
  orderNumber: null,
  shipmentId: null,
  shipmentNumber: null,
  shipmentItemId: null,
  courierCode: null,
  issueCategoryLabel: null,
  issueSubcategoryLabel: null,
  handling: 'NONE',
  subject: 'RTO DAMAGED: Aviator OG Sunglass (AVIATO-GREE-BLAC)',
  description: null,
  resolutionAmountInr: null,
  resolutionWalletEntryId: null,
  resolutionNotes: null,
  resolvedAt: null,
  createdAt: '2026-09-13T12:28:53.022Z',
} as unknown as TicketView;

describe('admin ticket queue', () => {
  it('shows the ticket number on each row', () => {
    state.rows = [ROW];
    render(<TicketsIndex />);
    expect(screen.getByText('TK-2026-000003')).toBeInTheDocument();
  });

  it('searches by what is typed, once typing stops', async () => {
    state.rows = [];
    state.calls = [];
    render(<TicketsIndex />);
    fireEvent.change(screen.getByLabelText('Search tickets'), {
      target: { value: 'TK-2026-000003' },
    });
    await waitFor(() =>
      expect(state.calls.at(-1)).toMatchObject({ search: 'TK-2026-000003', page: 1 }),
    );
  });
});
