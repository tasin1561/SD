/**
 * The seller's ticket conversation: whose words the opening message is,
 * and that there is always a way to reply on an open ticket.
 *
 * Both were wrong on the production scrap ticket for SD-TEST-524086: the
 * opening bubble was drawn as the seller's ("You") on a ticket WE opened,
 * and a ticket nobody had written on yet returned "Nothing said yet"
 * BEFORE the reply box, so the seller could not say anything at all.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toaster } from '@skydrop/ui/components';
import type { TicketView } from '@/lib/ops-hooks';

const state = vi.hoisted(() => ({ timeline: [] as unknown[] }));

vi.mock('@/lib/ops-hooks', () => ({
  useTicketTimeline: () => ({ isLoading: false, data: state.timeline }),
  useCourierThreadForTicket: () => ({ isLoading: false, data: undefined }),
  useReplyOnTicket: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { TicketConversation } from '../app/(authed)/tickets/_components/ticket-conversation';

const AT = '2026-09-13T12:28:53.022Z';

function ticket(over: Partial<TicketView> = {}): TicketView {
  return {
    id: 'ticket-1',
    ticketNumber: 'TK-2026-000003',
    openedBy: 'STAFF',
    ticketType: 'SCRAP_DAMAGE',
    status: 'OPEN',
    sellerId: 'seller-1',
    orderId: 'order-1',
    orderNumber: 'SD-TEST-524086',
    shipmentId: 'ship-1',
    shipmentNumber: 'SH-TEST-524086',
    shipmentItemId: 'si-1',
    courierCode: 'delhivery',
    issueCategoryLabel: null,
    issueSubcategoryLabel: null,
    handling: 'NONE',
    subject: 'RTO DAMAGED: Aviator OG Sunglass (AVIATO-GREE-BLAC)',
    description:
      'Ticket TK-2026-000003 — we opened this for you after inspecting a returned parcel.',
    resolutionAmountInr: null,
    resolutionWalletEntryId: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: AT,
    ...over,
  } as TicketView;
}

function show(t: TicketView): ReturnType<typeof render> {
  return render(
    <Toaster>
      <TicketConversation ticket={t} />
    </Toaster>,
  );
}

describe('seller ticket conversation', () => {
  it('a ticket WE opened opens with our message, on our side', () => {
    state.timeline = [{ note: 'Ticket opened', actorType: 'STAFF', at: AT, relayedAt: null }];
    show(ticket());
    expect(screen.getByText(/^Skydrop ·/)).toBeInTheDocument();
    expect(screen.queryByText(/^You ·/)).not.toBeInTheDocument();
    const bubble = screen.getByText(/we opened this for you/).closest('li');
    expect(bubble).toHaveClass('justify-start');
    // Ours has nowhere further to travel, so no relay state under it.
    expect(bubble?.querySelector('p.mt-1')).toBeNull();
  });

  it('a ticket the seller raised opens with their words, and keeps its relay state', () => {
    state.timeline = [
      { note: 'Ticket opened', actorType: 'SELLER', at: AT, relayedAt: '2026-09-13T13:00:00Z' },
    ];
    show(
      ticket({
        openedBy: 'SELLER',
        ticketType: 'SELLER_RAISED_ISSUE',
        description: 'The customer says it never arrived.',
      }),
    );
    expect(screen.getByText(/^You ·/)).toBeInTheDocument();
    const bubble = screen.getByText('The customer says it never arrived.').closest('li');
    expect(bubble).toHaveClass('justify-end');
    expect(bubble?.querySelector('p.mt-1')).not.toBeNull();
  });

  it('an open ticket with nothing said yet still offers the reply box', () => {
    state.timeline = [];
    show(ticket({ description: null }));
    expect(screen.getByText(/Nothing said yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Reply on this ticket')).toBeInTheDocument();
  });

  it('a closed ticket with nothing said shows the closed note instead of a box', () => {
    state.timeline = [];
    show(ticket({ description: null, status: 'REJECTED', resolvedAt: AT }));
    expect(screen.getByText(/This ticket is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply on this ticket')).not.toBeInTheDocument();
  });
});
