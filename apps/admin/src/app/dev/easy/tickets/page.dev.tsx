'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { TicketsIndex } from '../../../(authed)/tickets/_components/tickets-index';
import { AdminTicketDetail } from '../../../(authed)/tickets/_components/admin-ticket-detail';
import { EasyHarness, ago, json, type Respond } from '../harness';
import { SELLERS } from '../call-fixtures';

/**
 * /dev/easy/tickets — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  the list, five tickets   b  an empty list   c  the list fails
 *            d  ONE ticket's detail page (open, ready to decide)
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const STATUSES = ['OPEN', 'NEGOTIATING', 'RESOLVED_REFUND', 'REJECTED', 'OPEN'];

const TICKETS = STATUSES.map((status, i) => ({
  id: `ticket-${i}`,
  ticketNumber: `TK-2026-00000${i + 3}`,
  openedBy: i % 2 === 0 ? 'STAFF' : 'SELLER',
  ticketType: i % 2 === 0 ? 'SCRAP_DAMAGE' : 'OTHER',
  status,
  sellerId: 's1',
  orderId: 'order-1',
  orderNumber: `SD-2026-26-00016${i}`,
  shipmentId: 'ship-1',
  shipmentNumber: `SHP-2026-0006${i}`,
  shipmentItemId: 'si-1',
  courierCode: 'delhivery',
  issueCategoryLabel: null,
  issueSubcategoryLabel: null,
  handling: 'NONE',
  subject:
    i === 1
      ? 'The customer says the parcel arrived opened and one of the two items was missing from the box'
      : 'RTO DAMAGED: Aviator OG Sunglass (AVIATO-GREE-BLAC)',
  description: 'We opened this for you after inspecting a returned parcel.',
  resolutionAmountInr: status === 'RESOLVED_REFUND' ? '450.00' : null,
  resolutionWalletEntryId: null,
  resolutionNotes: null,
  resolvedAt: status.startsWith('RESOLVED') || status === 'REJECTED' ? ago(60 * 5) : null,
  createdAt: ago(60 * 24 * (i + 1)),
}));

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/tickets') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    const items = fixture === 'b' ? [] : TICKETS;
    return json({ items, total: items.length, page: 1, pageSize: 20 });
  }
  if (/^\/api\/admin\/tickets\/[^/]+\/events$/.test(req.path)) {
    return json([
      {
        id: 'ev-1',
        note: 'Ticket opened',
        actorType: 'STAFF',
        createdAt: ago(600),
        relayedAt: null,
      },
      {
        id: 'ev-2',
        note: 'The box was fine when it left us. Please check with the courier.',
        actorType: 'SELLER',
        createdAt: ago(300),
        relayedAt: null,
      },
    ]);
  }
  if (/^\/api\/admin\/tickets\/[^/]+$/.test(req.path) && req.method === 'GET')
    return json(TICKETS[0]);
  if (req.path === '/api/admin/sellers') return json(SELLERS);
  if (req.method !== 'GET') return json(TICKETS[0]);
  return undefined;
};

function Screen(): ReactElement | null {
  const [fixture, setFixture] = useState<string | null>(null);
  useEffect(() => {
    setFixture(new URLSearchParams(window.location.search).get('fixture') ?? 'a');
  }, []);
  if (fixture === null) return null;
  return fixture === 'd' ? <AdminTicketDetail ticketId="ticket-0" /> : <TicketsIndex />;
}

export default function TicketsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'tickets.view',
        'tickets.manage',
        'tickets.resolve',
        'orders.view',
        'sellers.view',
      ]}
    >
      <Screen />
    </EasyHarness>
  );
}
