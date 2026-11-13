'use client';

import type { ReactElement } from 'react';
import { CallCenterStation } from '../../../(authed)/call-center/_components/call-center-station';
import '../../../(authed)/orders/_components/order-ops.css';
import { EasyHarness, ago, json, type Respond } from '../harness';

/**
 * /dev/easy/call-center — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  a confirmation call in hand (COD, two items, one earlier call)
 *            b  a follow-up call for a client's issue (one "Called" outcome)
 *            c  available, queue empty        d  marked unavailable
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

function call(kind: 'CONFIRMATION' | 'TICKET'): unknown {
  return {
    assignmentId: '01a0f2a6-4f66-7bb0-9657-872a6237734b',
    orderId: 'order-1',
    scheduledAttempts: 2,
    assignedAt: ago(1),
    callPurpose:
      kind === 'CONFIRMATION'
        ? { kind, headline: 'Confirm this order with the customer', sellerAsked: null }
        : {
            kind,
            headline: 'The client asked us to phone this customer',
            sellerAsked: 'Ask if she can take delivery on Saturday.',
          },
    openTickets:
      kind === 'CONFIRMATION'
        ? []
        : [{ ticketId: 't1', subject: 'Delivery day', detail: 'Customer travels on Friday' }],
    priorAttempts: [
      {
        attemptId: 'p1',
        outcome: 'NO_ANSWER',
        isThisOrder: true,
        orderNumber: 'SD-2026-26-000365',
        startedAt: ago(60 * 5),
        agentEmail: 'agent@skydrop.global',
        rescheduledFor: null,
        notes: null,
      },
    ],
    seller: { contactPersonName: 'Menev Store', phone: '+8801700000000' },
    customerBrand: null,
    itemDisplay: {},
    order: {
      orderId: 'order-1',
      orderNumber: 'SD-2026-26-000365',
      status: 'PENDING_CONFIRMATION',
      recipient: {
        name: 'Asha Verma',
        phoneE164: '+919000000012',
        altPhoneE164: null,
        addressLine1: '12 MG Road',
        addressLine2: 'Near the temple',
        landmark: 'Opposite SBI ATM',
        city: 'Bengaluru',
        stateProvince: 'Karnataka',
        postalCode: '560001',
      },
      paymentMode: 'COD',
      codAmountInr: '1250.00',
      items: [
        {
          variantId: 'v1',
          skuCode: 'AVIATO-BLAC-GOLD',
          productName: 'Aviator OG Sunglass',
          variantLabel: 'Black / Golden',
          quantity: 1,
        },
        {
          variantId: 'v2',
          skuCode: 'WALLET-BRN',
          productName: 'Leather wallet',
          variantLabel: 'Brown',
          quantity: 2,
        },
      ],
    },
  };
}

const respond: Respond<F> = (fixture, req) => {
  const p = req.path;
  if (p === '/api/agent/settings') return json({ isAvailable: fixture !== 'd' });
  if (p === '/api/agent/settings/heartbeat') return json({});
  if (p === '/api/agent/calls/current') {
    return json({
      assignments:
        fixture === 'a' ? [call('CONFIRMATION')] : fixture === 'b' ? [call('TICKET')] : [],
    });
  }
  if (p === '/api/agent/calls/next') return json({ assignment: null });
  if (p === '/api/agent/calls/history') return json({ items: [], total: 0, page: 1, pageSize: 10 });
  if (p.endsWith('/customer-reputation')) {
    return json({
      phoneE164: '+919000000012',
      platform: {
        totalOrders: 1,
        delivered: 0,
        returned: 0,
        refusedOnCall: 0,
        returnRatePercent: null,
        firstOrderAt: null,
        lastOrderAt: null,
      },
      yours: { totalOrders: 1, delivered: 0, returned: 0, recentOrders: [], openOrders: [] },
      riskLevel: 'NONE',
      riskNotes: null,
      customerName: null,
    });
  }
  if (p.endsWith('/address-check')) return json({ code: 'NOT_FOUND', message: 'none' }, 404);
  if (p.includes('serviceab')) return json({ known: true, serviceable: true, reason: null });
  if (p.endsWith('/record-attempt')) {
    return json({
      outcome: (req.body as { outcome?: string } | null)?.outcome ?? '',
      finalOrderStatus: 'CONFIRMED',
    });
  }
  if (p.endsWith('/release')) return json({});
  return undefined;
};

export default function CallCenterHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['callcenter.work', 'tickets.resolve', 'orders.view']}
    >
      <div className="oo-page">
        <CallCenterStation />
      </div>
    </EasyHarness>
  );
}
