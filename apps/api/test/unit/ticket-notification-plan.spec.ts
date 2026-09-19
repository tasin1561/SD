import { ActorType, SellerNotificationCategory, TicketStatus, TicketType } from '@skydrop/db';
import {
  planTicketNotification,
  sellerCategoryFor,
  sideOf,
  TICKET_OPENED_EMAIL_TEMPLATE,
  TICKET_OPENED_FOR_YOU_TOPIC,
  TICKET_REPLY_EMAIL_TEMPLATE,
  TICKET_REPLY_TOPIC,
  TICKET_RESOLVED_EMAIL_TEMPLATE,
  TICKET_RESOLVED_TOPIC,
  TICKET_SELLER_OPENED_TOPIC,
  TICKET_SELLER_REPLIED_TOPIC,
  type TicketFacts,
} from '../../src/modules/ticket/services/ticket-notification-plan';

/**
 * TKT-3 — who is told about a ticket event. The rule under test: our
 * words go to the seller, the seller's words go to us, an outcome goes to
 * the seller whoever reached it, and nobody hears about their own act.
 */
const TICKET: TicketFacts = {
  ticketNumber: 'TK-2026-000004',
  ticketType: TicketType.RECEIPT_SHORTFALL,
  subject: 'CN-2026-08-000003: 2 short at DAC-01',
  description: 'Ticket TK-2026-000004 — we opened this for you…',
  resolutionAmountInr: null,
  companyName: 'Menev Store',
};

describe('planTicketNotification', () => {
  it('a ticket WE opened (staff or system) tells the seller, with our opening message', () => {
    for (const actorType of [ActorType.SYSTEM, ActorType.STAFF]) {
      const plan = planTicketNotification(
        { fromStatus: null, toStatus: TicketStatus.OPEN, note: 'Ticket opened', actorType },
        TICKET,
      );
      expect(plan.staff).toBeNull();
      expect(plan.seller).toMatchObject({
        kind: 'OPENED_FOR_YOU',
        topic: TICKET_OPENED_FOR_YOU_TOPIC,
        emailTemplate: TICKET_OPENED_EMAIL_TEMPLATE,
        title: 'We opened ticket TK-2026-000004: CN-2026-08-000003: 2 short at DAC-01',
        body: TICKET.description,
      });
    }
  });

  it('a STORE_ISSUE tells STAFF only — the seller is not party to it', () => {
    // 2026-09-16. The store is telling US a parcel was damaged or lost in
    // our hands. Routed through the STORE_DISPUTE branch it would have
    // emailed the seller "a dispute was raised with you", which is false
    // twice: it is not a dispute, and not with them.
    const plan = planTicketNotification(
      {
        fromStatus: null,
        toStatus: TicketStatus.OPEN,
        note: 'Ticket opened',
        actorType: ActorType.STORE,
      },
      {
        ...TICKET,
        ticketType: TicketType.STORE_ISSUE,
        storeName: 'Kolkata Kurtas',
        description: 'The parcel came back crushed.',
      },
    );
    expect(plan.seller).toBeNull();
    expect(plan.staff).toMatchObject({
      topic: TICKET_SELLER_OPENED_TOPIC,
      body: 'The parcel came back crushed.',
    });
    expect(plan.staff?.title).toContain('raised TK-2026-000004 with us');
  });

  it('a STORE_ISSUE reply also stops at staff', () => {
    const plan = planTicketNotification(
      {
        fromStatus: TicketStatus.OPEN,
        toStatus: TicketStatus.OPEN,
        note: 'Any news?',
        actorType: ActorType.STORE,
      },
      { ...TICKET, ticketType: TicketType.STORE_ISSUE, storeName: 'Kolkata Kurtas' },
    );
    expect(plan.seller).toBeNull();
    expect(plan.staff).toMatchObject({ topic: TICKET_SELLER_REPLIED_TOPIC, body: 'Any news?' });
  });

  it('a STORE_DISPUTE still reaches the seller — the new type did not swallow the old one', () => {
    const plan = planTicketNotification(
      {
        fromStatus: null,
        toStatus: TicketStatus.OPEN,
        note: 'Ticket opened',
        actorType: ActorType.STORE,
      },
      {
        ...TICKET,
        ticketType: TicketType.STORE_DISPUTE,
        storeName: 'Kolkata Kurtas',
        description: 'Wrong colour sent.',
      },
    );
    expect(plan.seller).toMatchObject({ kind: 'OPENED_FOR_YOU' });
    expect(plan.seller?.title).toContain('raised dispute');
    expect(plan.staff).not.toBeNull();
  });

  it('a ticket the SELLER opened tells staff, not the seller', () => {
    for (const actorType of [ActorType.SELLER, ActorType.API]) {
      const plan = planTicketNotification(
        { fromStatus: null, toStatus: TicketStatus.OPEN, note: 'Ticket opened', actorType },
        {
          ...TICKET,
          ticketType: TicketType.SELLER_RAISED_ISSUE,
          description: 'Parcel arrived empty',
        },
      );
      expect(plan.seller).toBeNull();
      expect(plan.staff).toEqual({
        topic: TICKET_SELLER_OPENED_TOPIC,
        title: `Menev Store opened ticket TK-2026-000004: ${TICKET.subject}`,
        body: 'Parcel arrived empty',
      });
    }
  });

  it('our note on an open ticket is a reply to the seller', () => {
    const plan = planTicketNotification(
      {
        fromStatus: TicketStatus.OPEN,
        toStatus: TicketStatus.OPEN,
        note: 'We found 2 in a second carton.',
        actorType: ActorType.STAFF,
      },
      TICKET,
    );
    expect(plan.staff).toBeNull();
    expect(plan.seller).toMatchObject({
      kind: 'REPLY',
      topic: TICKET_REPLY_TOPIC,
      emailTemplate: TICKET_REPLY_EMAIL_TEMPLATE,
      body: 'We found 2 in a second carton.',
    });
  });

  it("the seller's reply goes to staff", () => {
    const plan = planTicketNotification(
      {
        fromStatus: TicketStatus.NEGOTIATING,
        toStatus: TicketStatus.NEGOTIATING,
        note: 'Our packing list says 200.',
        actorType: ActorType.SELLER,
      },
      TICKET,
    );
    expect(plan.seller).toBeNull();
    expect(plan.staff).toEqual({
      topic: TICKET_SELLER_REPLIED_TOPIC,
      title: 'Menev Store replied on ticket TK-2026-000004',
      body: 'Our packing list says 200.',
    });
  });

  it('a refund resolution tells the seller the amount', () => {
    const plan = planTicketNotification(
      {
        fromStatus: TicketStatus.OPEN,
        toStatus: TicketStatus.RESOLVED_REFUND,
        note: 'Lost by the forwarder.',
        actorType: ActorType.STAFF,
      },
      { ...TICKET, resolutionAmountInr: '640.00' },
    );
    expect(plan.seller).toMatchObject({
      kind: 'RESOLVED',
      topic: TICKET_RESOLVED_TOPIC,
      emailTemplate: TICKET_RESOLVED_EMAIL_TEMPLATE,
      title: 'Ticket TK-2026-000004 closed — ₹640.00 refunded to your wallet',
    });
    expect(plan.seller?.body).toBe(
      'We settled it with a refund of ₹640.00, credited to your wallet.\n\nOur note: Lost by the forwarder.',
    );
  });

  it('every settled outcome is told, and says what it was', () => {
    for (const to of [
      TicketStatus.RESOLVED_RETURNED,
      TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
      TicketStatus.REJECTED,
    ]) {
      const plan = planTicketNotification(
        {
          fromStatus: TicketStatus.NEGOTIATING,
          toStatus: to,
          note: null,
          actorType: ActorType.STAFF,
        },
        TICKET,
      );
      expect(plan.seller?.kind).toBe('RESOLVED');
      expect(plan.seller?.body.length).toBeGreaterThan(10);
    }
  });

  it('a move with nothing said tells nobody', () => {
    const plan = planTicketNotification(
      {
        fromStatus: TicketStatus.OPEN,
        toStatus: TicketStatus.NEGOTIATING,
        note: '   ',
        actorType: ActorType.STAFF,
      },
      TICKET,
    );
    // `store` joined the plan on 2026-09-19 (RS-7 gained an inbox), so
    // "tells nobody" is now all THREE sides being null.
    expect(plan).toEqual({ seller: null, staff: null, store: null });
  });

  it('files a ticket under the email category it is about (F2)', () => {
    expect(sellerCategoryFor(TicketType.RECEIPT_SHORTFALL)).toBe(
      SellerNotificationCategory.STOCK_ALERTS,
    );
    expect(sellerCategoryFor(TicketType.SCRAP_DAMAGE)).toBe(
      SellerNotificationCategory.SHIPMENT_UPDATES,
    );
    expect(sideOf(ActorType.API)).toBe('SELLER');
    expect(sideOf(ActorType.SYSTEM)).toBe('US');
  });
});
