/**
 * The admin view of a ticket conversation: the opening message sits with
 * whoever opened the ticket, the seller's own opening message can still be
 * marked as passed to the courier (TKT-2), and an open ticket with nothing
 * said yet still offers the reply box.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toaster } from '@skydrop/ui/components';
import type { TicketView } from '@/lib/ops-hooks';

const state = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock('@/lib/ops-hooks', () => ({
  useTicketEvents: () => ({ isLoading: false, data: state.events }),
  useCourierThreadForTicket: () => ({ isLoading: false, data: undefined }),
  useCourierThread: () => ({ isLoading: false, data: undefined }),
  useReplyToSellerOnTicket: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useMarkTicketMessageRelayed: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('@/lib/use-permission', () => ({ usePermission: () => true }));

import { AdminTicketConversation } from '../app/(authed)/tickets/_components/admin-ticket-conversation';

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
      <AdminTicketConversation ticket={t} />
    </Toaster>,
  );
}

describe('admin ticket conversation', () => {
  it('a ticket we opened opens with our message, and offers nothing to relay', () => {
    state.events = [
      { id: 'ev-1', note: 'Ticket opened', actorType: 'STAFF', createdAt: AT, relayedAt: null },
    ];
    show(ticket());
    expect(screen.getByText(/^Skydrop ·/)).toBeInTheDocument();
    expect(screen.queryByText(/^Seller ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });

  it("a seller's own opening message is theirs, and can still be marked as passed on", () => {
    state.events = [
      { id: 'ev-1', note: 'Ticket opened', actorType: 'SELLER', createdAt: AT, relayedAt: null },
    ];
    show(
      ticket({
        openedBy: 'SELLER',
        ticketType: 'SELLER_RAISED_ISSUE',
        description: 'The customer says it never arrived.',
      }),
    );
    expect(screen.getByText(/^Seller ·/)).toBeInTheDocument();
    expect(screen.getByText('The customer says it never arrived.').closest('li')).toHaveClass(
      'justify-end',
    );
    expect(screen.getByRole('button', { name: 'Mark delivered' })).toBeInTheDocument();
  });

  it('an open ticket with nothing said yet still offers the reply box', () => {
    state.events = [];
    show(ticket({ description: null }));
    expect(screen.getByText('Nothing said yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Reply to the seller')).toBeInTheDocument();
  });

  it('a closed ticket with nothing said offers no reply box', () => {
    state.events = [];
    show(ticket({ description: null, status: 'REJECTED', resolvedAt: AT }));
    expect(screen.queryByLabelText('Reply to the seller')).not.toBeInTheDocument();
  });

  /*
    THE STORE IS A THIRD VOICE. Every one of these was labelled "Skydrop"
    until 2026-10-04, because the component asked `openedBy === 'SELLER'`
    and put everything else on our side — while the subtitle two inches
    above it already said "Raised … by Silk Studio".
  */
  it("a store's dispute is the STORE's words, named, on their side", () => {
    state.events = [
      { id: 'ev-1', note: 'Ticket opened', actorType: 'STORE', createdAt: AT, relayedAt: null },
    ];
    show(
      ticket({
        openedBy: 'STORE',
        ticketType: 'STORE_DISPUTE',
        storeName: 'Silk Studio',
        description: 'The saree arrived with a tear along the border.',
      } as Partial<TicketView>),
    );
    expect(screen.getByText(/^Silk Studio ·/)).toBeInTheDocument();
    expect(screen.queryByText(/^Skydrop ·/)).not.toBeInTheDocument();
    expect(
      screen.getByText('The saree arrived with a tear along the border.').closest('li'),
    ).toHaveClass('justify-end');
    // TKT-2's relay is "I have taken this to the courier". A dispute has
    // no courier in it, so there is nothing to offer.
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });

  it("a store's REPLY is theirs too, not ours", () => {
    state.events = [
      { id: 'ev-1', note: 'Ticket opened', actorType: 'STORE', createdAt: AT, relayedAt: null },
      {
        id: 'ev-2',
        note: 'We have the photographs if you want them.',
        actorType: 'STORE',
        createdAt: AT,
        relayedAt: null,
      },
    ];
    show(
      ticket({
        openedBy: 'STORE',
        ticketType: 'STORE_DISPUTE',
        storeName: 'Silk Studio',
        description: 'The saree arrived with a tear along the border.',
      } as Partial<TicketView>),
    );
    expect(screen.getByText('We have the photographs if you want them.').closest('li')).toHaveClass(
      'justify-end',
    );
  });

  /*
    A reply on a dispute reaches BOTH parties — the notification plan's
    own rule since the store got an inbox — so a box labelled "Reply to
    the seller" tells an operator the wrong thing about who is listening.
  */
  it('on a dispute the reply box says both sides read it', () => {
    state.events = [];
    show(
      ticket({
        openedBy: 'STORE',
        ticketType: 'STORE_DISPUTE',
        storeName: 'Silk Studio',
        description: null,
      } as Partial<TicketView>),
    );
    expect(screen.getByLabelText('Reply to the seller and Silk Studio')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply to the seller')).not.toBeInTheDocument();
  });
});
