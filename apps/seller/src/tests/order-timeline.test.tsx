import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OrderEventType, OrderStatus, ActorType } from '@skydrop/db';
import type { SellerOrderEventView } from '@skydrop/api-client';
import { OrderTimeline } from '../app/(authed)/orders/_components/order-timeline';

/**
 * CP2.A.5 — seller order timeline smoke test.
 *
 * Establishes the seller test harness pattern (helpers.tsx +
 * AuthProvider<SellerMe>) and pins the timeline rendering shape.
 * The timeline is a pure presentational component (no hooks, no
 * navigation) so it tests cleanly without router mocking.
 *
 * What this proves:
 *   - The SellerOrderEventView shape flows from @skydrop/api-client
 *     through the UI render path correctly.
 *   - Status transitions render BOTH from + to badges via FE-6 tokens
 *     (no hardcoded hex anywhere — the OrderStatusBadge reads from
 *     @skydrop/ui/status).
 *   - Description-only events (no status transition) render without
 *     the transition arrow.
 *
 * The order-detail.tsx's privacy boundary (admin-only fields like
 * internalNotes / callNotes are NOT rendered by the seller view)
 * is enforced structurally — those fields aren't referenced in the
 * JSX — and the typecheck already proves it. A vitest mirror would
 * be redundant.
 */

const baseEvent: Omit<SellerOrderEventView, 'id' | 'type'> = {
  fromStatus: null,
  toStatus: null,
  description: null,
  data: null,
  actorType: ActorType.SYSTEM,
  createdAt: '2026-05-29T10:00:00.000Z',
};

describe('OrderTimeline', () => {
  it('renders status transition badges for STATUS_CHANGED events', () => {
    const events: SellerOrderEventView[] = [
      {
        ...baseEvent,
        id: 'e1',
        type: OrderEventType.STATUS_CHANGED,
        fromStatus: OrderStatus.PENDING_CONFIRMATION,
        toStatus: OrderStatus.CONFIRMED,
      },
    ];
    const { container } = render(<OrderTimeline events={events} />);
    // Both badges present (from + to). The OrderStatusBadge sets a
    // data-status-kind attribute so we assert the FE-6 path was taken.
    const kinds = container.querySelectorAll('[data-status-kind]');
    expect(kinds.length).toBe(2);
    // Render is "Status Changed" + "Pending Confirmation" → "Confirmed".
    expect(container.textContent).toContain('Status Changed');
    expect(container.textContent).toContain('Pending Confirmation');
    expect(container.textContent).toContain('Confirmed');
  });

  it('renders description-only events without a status arrow', () => {
    const events: SellerOrderEventView[] = [
      {
        ...baseEvent,
        id: 'e1',
        type: OrderEventType.NOTE_ADDED,
        description: 'Seller note added',
      },
    ];
    const { container } = render(<OrderTimeline events={events} />);
    expect(container.querySelectorAll('[data-status-kind]').length).toBe(0);
    expect(container.textContent).toContain('Seller note added');
    expect(container.textContent).toContain('Note Added');
    // No "→" arrow when there's no transition.
    expect(container.textContent).not.toContain('→');
  });

  it('renders multiple events in order (latest at the bottom — admin-tooling reading direction)', () => {
    const events: SellerOrderEventView[] = [
      {
        ...baseEvent,
        id: 'e1',
        type: OrderEventType.STATUS_CHANGED,
        fromStatus: OrderStatus.PENDING_CONFIRMATION,
        toStatus: OrderStatus.CONFIRMED,
        createdAt: '2026-05-29T10:00:00.000Z',
      },
      {
        ...baseEvent,
        id: 'e2',
        type: OrderEventType.DISPATCHED,
        fromStatus: OrderStatus.PENDING_DISPATCH,
        toStatus: OrderStatus.DISPATCHED,
        createdAt: '2026-05-29T11:00:00.000Z',
      },
    ];
    const { container } = render(<OrderTimeline events={events} />);
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(2);
    // First li is the earlier event; second is the later one. The
    // server returns events ASC; we render them in the same order.
    expect(items[0]?.textContent).toContain('Status Changed');
    expect(items[1]?.textContent).toContain('Dispatched');
  });
});
