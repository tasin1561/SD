import { ActorType, SellerNotificationCategory, TicketStatus, TicketType } from '@skydrop/db';

/**
 * WHO hears about a ticket event, and what they are told (TKT-3).
 *
 * PURE: no Prisma, no clock, no I/O. `TicketNotifier` loads the event
 * and the ticket, asks this, and sends what it says. Kept apart so the
 * decision — the part that is easy to get subtly wrong — is tested on
 * its own, and so there is ONE place that says which side of a ticket
 * is told about what.
 *
 * The rule is "tell the OTHER side": our words go to the seller, the
 * seller's words go to us. Nobody is told about something they did
 * themselves.
 */

/** The in-app topics a SELLER's people can silence (NOTIF-17). */
export const TICKET_OPENED_FOR_YOU_TOPIC = 'ticket.opened_for_you';
export const TICKET_REPLY_TOPIC = 'ticket.reply';
export const TICKET_RESOLVED_TOPIC = 'ticket.resolved';
/** The in-app topics STAFF can silence. */
export const TICKET_SELLER_OPENED_TOPIC = 'ticket.seller_opened';
export const TICKET_SELLER_REPLIED_TOPIC = 'ticket.seller_replied';

/** The company's email copy of each seller notice. Seeded (NOTIF-22). */
export const TICKET_OPENED_EMAIL_TEMPLATE = 'seller.ticket_opened.email';
export const TICKET_REPLY_EMAIL_TEMPLATE = 'seller.ticket_reply.email';
export const TICKET_RESOLVED_EMAIL_TEMPLATE = 'seller.ticket_resolved.email';

/** Both apps gate their ticket screens on this key — seller and staff alike. */
export const TICKETS_VIEW_PERMISSION = 'tickets.view';

export type TicketSide = 'US' | 'SELLER';

/**
 * Whose words an event is. An API-key call is the seller acting through
 * their own systems; SYSTEM is software acting for us (an RTO inspection
 * opening a scrap ticket, a receipt count opening a shortfall ticket).
 */
export function sideOf(actor: ActorType): TicketSide {
  switch (actor) {
    case ActorType.STAFF:
    case ActorType.SYSTEM:
      return 'US';
    case ActorType.SELLER:
    case ActorType.API:
    case ActorType.STORE:
      // RS-2: a store never writes on a ticket in phase 1; not ours, so not US.
      return 'SELLER';
  }
}

/**
 * Which of the company's per-category email switches (NOTIF-15) covers a
 * ticket. There is no "support" category; a ticket is filed under what it
 * is ABOUT. F2: a new ticket type fails to compile until somebody decides.
 */
export function sellerCategoryFor(type: TicketType): SellerNotificationCategory {
  switch (type) {
    case TicketType.SCRAP_DAMAGE:
    case TicketType.SELLER_RAISED_ISSUE:
    case TicketType.COURIER_NDR_ESCALATION:
      return SellerNotificationCategory.SHIPMENT_UPDATES;
    case TicketType.RECEIPT_SHORTFALL:
      return SellerNotificationCategory.STOCK_ALERTS;
  }
}

/** The four SETTLED outcomes, in words a seller reads. */
function outcomeSentence(to: TicketStatus, refundInr: string | null): string | null {
  switch (to) {
    case TicketStatus.RESOLVED_REFUND:
      return refundInr === null
        ? 'We settled it with a refund to your wallet.'
        : `We settled it with a refund of ₹${refundInr}, credited to your wallet.`;
    case TicketStatus.RESOLVED_RETURNED:
      return 'We settled it by returning the goods to you.';
    case TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED:
      return 'It is closed as a write-off you accepted. No money moved.';
    case TicketStatus.REJECTED:
      return 'We closed it without a refund.';
    case TicketStatus.OPEN:
    case TicketStatus.NEGOTIATING:
    case TicketStatus.CLOSED_BY_COURIER:
      return null;
  }
}

export interface TicketEventFacts {
  readonly fromStatus: TicketStatus | null;
  readonly toStatus: TicketStatus;
  readonly note: string | null;
  readonly actorType: ActorType;
}

export interface TicketFacts {
  readonly ticketNumber: string;
  readonly ticketType: TicketType;
  readonly subject: string;
  readonly description: string | null;
  /** Set on a refund resolution, `"1234.00"`. */
  readonly resolutionAmountInr: string | null;
  readonly companyName: string;
}

export type SellerNoticeKind = 'OPENED_FOR_YOU' | 'REPLY' | 'RESOLVED';

export interface SellerNotice {
  readonly kind: SellerNoticeKind;
  readonly topic: string;
  readonly emailTemplate: string;
  /** In-app line. */
  readonly title: string;
  /** In-app body, and the email's `message`. */
  readonly body: string;
}

export interface StaffNotice {
  readonly topic: string;
  readonly title: string;
  readonly body: string;
}

export interface TicketNotificationPlan {
  readonly seller: SellerNotice | null;
  readonly staff: StaffNotice | null;
}

const NOTHING: TicketNotificationPlan = { seller: null, staff: null };

/** An inbox line is a summary; the ticket holds the whole message. */
const IN_APP_BODY_MAX = 600;

function clip(text: string): string {
  const t = text.trim();
  return t.length <= IN_APP_BODY_MAX ? t : `${t.slice(0, IN_APP_BODY_MAX - 1).trimEnd()}…`;
}

const TERMINAL: readonly TicketStatus[] = [
  TicketStatus.RESOLVED_REFUND,
  TicketStatus.RESOLVED_RETURNED,
  TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
  TicketStatus.REJECTED,
];

export function planTicketNotification(
  event: TicketEventFacts,
  ticket: TicketFacts,
): TicketNotificationPlan {
  const side = sideOf(event.actorType);
  const note = event.note?.trim() ?? '';
  const num = ticket.ticketNumber;

  // Opened. Its note is the fixed "Ticket opened"; what was SAID is the
  // ticket's description.
  if (event.fromStatus === null) {
    const said = ticket.description?.trim() ?? '';
    if (side === 'US') {
      return {
        seller: {
          kind: 'OPENED_FOR_YOU',
          topic: TICKET_OPENED_FOR_YOU_TOPIC,
          emailTemplate: TICKET_OPENED_EMAIL_TEMPLATE,
          title: `We opened ticket ${num}: ${ticket.subject}`,
          body: said === '' ? ticket.subject : said,
        },
        staff: null,
      };
    }
    return {
      seller: null,
      staff: {
        topic: TICKET_SELLER_OPENED_TOPIC,
        title: `${ticket.companyName} opened ticket ${num}: ${ticket.subject}`,
        body: clip(said === '' ? ticket.subject : said),
      },
    };
  }

  // Settled. Told to the seller whoever did it — it is their outcome.
  if (event.fromStatus !== event.toStatus && TERMINAL.includes(event.toStatus)) {
    const outcome = outcomeSentence(event.toStatus, ticket.resolutionAmountInr) ?? '';
    const body = [outcome, note === '' ? '' : `Our note: ${note}`]
      .filter((s) => s !== '')
      .join('\n\n');
    return {
      seller: {
        kind: 'RESOLVED',
        topic: TICKET_RESOLVED_TOPIC,
        emailTemplate: TICKET_RESOLVED_EMAIL_TEMPLATE,
        title:
          event.toStatus === TicketStatus.RESOLVED_REFUND && ticket.resolutionAmountInr !== null
            ? `Ticket ${num} closed — ₹${ticket.resolutionAmountInr} refunded to your wallet`
            : `Ticket ${num} is closed`,
        body,
      },
      staff: null,
    };
  }

  // A message on an open ticket — a reply (a self-loop) or a move that
  // carried a note. A move with nothing said tells nobody anything new.
  if (note === '') return NOTHING;
  if (side === 'US') {
    return {
      seller: {
        kind: 'REPLY',
        topic: TICKET_REPLY_TOPIC,
        emailTemplate: TICKET_REPLY_EMAIL_TEMPLATE,
        title: `New reply on ticket ${num}: ${ticket.subject}`,
        body: note,
      },
      staff: null,
    };
  }
  return {
    seller: null,
    staff: {
      topic: TICKET_SELLER_REPLIED_TOPIC,
      title: `${ticket.companyName} replied on ticket ${num}`,
      body: clip(note),
    },
  };
}

/** The in-app body is clipped; the email carries the whole message. */
export function inAppBody(notice: SellerNotice): string {
  return clip(notice.body);
}
