/**
 * The seller's ticket list shows each ticket's NUMBER (TK-…), says who
 * raised it from the server's record rather than guessing from the type,
 * and searches by the number they were given.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TicketView } from '@/lib/ops-hooks';

const state = vi.hoisted(() => ({ calls: [] as unknown[], rows: [] as unknown[] }));

vi.mock('@/lib/ops-hooks', () => ({
  useSellerTickets: (query: unknown) => {
    state.calls.push(query);
    return { isLoading: false, isError: false, data: state.rows, refetch: vi.fn() };
  },
}));
vi.mock('@/lib/page-access', () => ({ can: () => true }));
vi.mock('@skydrop/auth/client', () => ({ useSellerIdentity: () => ({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../app/(authed)/tickets/_components/raise-ticket-modal', () => ({
  RaiseTicketModal: () => null,
}));
vi.mock('../app/(authed)/tickets/_components/courier-thread', () => ({
  CourierThread: () => null,
}));
vi.mock('../app/(authed)/tickets/_components/ticket-timeline', () => ({
  TicketTimeline: () => null,
}));

import { SellerTicketsIndex } from '../app/(authed)/tickets/_components/tickets-index';

function row(over: Partial<TicketView>): TicketView {
  return {
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
    ...over,
  } as TicketView;
}

describe('seller ticket list', () => {
  it('shows the ticket number and who raised each one', () => {
    state.rows = [
      row({}),
      row({
        id: 'ticket-2',
        ticketNumber: 'TK-2026-000001',
        openedBy: 'SELLER',
        ticketType: 'SELLER_RAISED_ISSUE',
        subject: 'Call the customer for me',
      }),
    ];
    render(<SellerTicketsIndex />);
    expect(screen.getByText('TK-2026-000003')).toBeInTheDocument();
    expect(screen.getByText('TK-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('Skydrop')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('searches by what is typed, once typing stops', async () => {
    state.rows = [];
    state.calls = [];
    render(<SellerTicketsIndex />);
    fireEvent.change(screen.getByLabelText('Search tickets'), {
      target: { value: 'TK-2026-000003' },
    });
    await waitFor(() => expect(state.calls.at(-1)).toMatchObject({ search: 'TK-2026-000003' }));
  });
});
