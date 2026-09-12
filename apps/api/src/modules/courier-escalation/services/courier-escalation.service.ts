import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  CourierMessageChannel,
  CourierMessageDirection,
  CourierOutboxKind,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierMessageClassifierService } from './courier-message-classifier.service';
import { CourierOutboxService } from './courier-outbox.service';
import { minuteBucketOf } from './courier-escalation-ingest.service';

export interface EscalationThreadMessage {
  readonly id: string;
  readonly direction: CourierMessageDirection;
  readonly channel: CourierMessageChannel;
  /** VERBATIM — what the courier wrote, or what the seller wrote. */
  readonly body: string;
  readonly occurredAt: Date;
  /** A LABEL from the classifier. Drives badges, never the text. */
  readonly state: string | null;
  readonly templateCode: string | null;
  readonly needsReview: boolean;
}

/**
 * Only when a ticket names no parcel at all — the same value as the
 * `courier_escalations.courier_code` column default. Every escalation
 * with a parcel is filed under the courier that carried it.
 */
const LEGACY_DEFAULT_COURIER = 'delhivery';

export interface EscalationView {
  readonly id: string;
  readonly ticketId: string;
  readonly externalTicketId: string | null;
  readonly awbNumber: string | null;
  /** Whose desk — the courier that carried the parcel. */
  readonly courierCode: string;
  readonly state: string | null;
  readonly lastMessageAt: Date | null;
  readonly needsReviewAt: Date | null;
  /** Outbound messages not yet confirmed with the courier. */
  readonly pendingOutbound: number;
  readonly messages: readonly EscalationThreadMessage[];
}

/**
 * The escalation's own lifecycle — and, until now, the thing that did not
 * exist.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────
 * Phases 2 to 5 built a read pipeline, an outbox, an ops console and a
 * browser worker, and NOTHING created a `CourierEscalation` or enqueued an
 * outbox item. Every gate was green because each piece was correct in
 * isolation: the ingest returned `NO_ESCALATION` for every message, the
 * console listed an outbox that could not contain anything, and the portal
 * shadowed the same empty queue. A pipeline joined to two missing ends
 * passes every unit test in it.
 *
 * This is the entry point. `openForTicket` is what turns an R7 ticket into
 * a conversation with the courier, and `postReply` is what puts a seller's
 * words into the outbox.
 *
 * ── IT HANGS OFF A TICKET, IDEMPOTENTLY ──────────────────────────────
 * `courier_escalations.ticket_id` is UNIQUE, so the second call returns
 * the first row rather than failing. That matters because the NDR poller
 * can escalate the same shipment twice on separate nights, and a duplicate
 * escalation would split one courier conversation across two threads.
 */
@Injectable()
export class CourierEscalationService {
  private readonly logger = new Logger(CourierEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: CourierOutboxService,
    private readonly classifier: CourierMessageClassifierService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Begin (or find) the courier conversation for a ticket.
   *
   * Idempotent on `ticketId`: a P2002 means someone else got there first,
   * which is a success, not a collision.
   */
  async openForTicket(input: {
    ticketId: string;
    awbNumber?: string | null;
    categoryId?: string | null;
    courierCode?: string;
    /**
     * WHICH of the courier's accounts carried this parcel (CACC-1).
     *
     * Carried on the escalation so every later step — the raise, the
     * replies, the closure — happens on the panel that can actually see
     * the waybill. A ticket raised on the wrong login is filed against a
     * parcel that account does not have.
     */
    courierAccountId?: string | null;
  }): Promise<{ id: string; created: boolean }> {
    const existing = await this.prisma.client.courierEscalation.findUnique({
      where: { ticketId: input.ticketId },
      select: { id: true },
    });
    if (existing !== null) return { id: existing.id, created: false };

    // WHOSE desk this conversation belongs to is a fact about the parcel,
    // not a default. Every caller that did not say — the ticket panel's
    // "Start a courier conversation", a delivery action — used to file
    // the escalation under Delhivery whatever carried it, so a Shiprocket
    // parcel's message was queued for Delhivery One and, the day
    // Delhivery's reads come up, would have been read back from the wrong
    // company. Resolved from the ticket's own parcel instead.
    const parcel =
      input.courierCode === undefined || (input.awbNumber ?? null) === null
        ? await this.parcelForTicket(input.ticketId)
        : null;

    try {
      const row = await this.prisma.client.courierEscalation.create({
        data: {
          ticketId: input.ticketId,
          awbNumber: input.awbNumber ?? parcel?.awbNumber ?? null,
          categoryId: input.categoryId ?? null,
          // Last resort only when the ticket names no parcel at all:
          // mirrors the column's own schema default.
          courierCode: input.courierCode ?? parcel?.courierCode ?? LEGACY_DEFAULT_COURIER,
          courierAccountId: input.courierAccountId ?? parcel?.courierAccountId ?? null,
        },
        select: { id: true },
      });
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'courier.escalation.opened',
        entityType: 'courier_escalation',
        entityId: row.id,
        severity: 'LOW',
        metadata: { ticketId: input.ticketId, awbNumber: input.awbNumber ?? null },
      });
      return { id: row.id, created: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Lost the race. The unique index is the guard; this is the
        // success path for a concurrent second call.
        const row = await this.prisma.client.courierEscalation.findUniqueOrThrow({
          where: { ticketId: input.ticketId },
          select: { id: true },
        });
        return { id: row.id, created: false };
      }
      throw err;
    }
  }

  /**
   * The waybill a ticket is about, and whose account and courier carried it.
   *
   * Read from the ticket's own shipment, and from the ORDER's latest
   * waybill-bearing shipment when the ticket names no parcel — a seller
   * raising an issue from an order page has an order id and no shipment
   * id, which is the common shape. The waybill, the account and the
   * courier come from the SAME row: read separately they could disagree,
   * and the raise would go to a desk that cannot see the waybill it was
   * given. The courier is returned even with no waybill yet — who would
   * carry it is knowable before the parcel is booked.
   */
  async parcelForTicket(ticketId: string): Promise<{
    awbNumber: string | null;
    courierAccountId: string | null;
    courierCode: string | null;
  } | null> {
    const pick = { awbNumber: true, courierAccountId: true, courierCode: true } as const;
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: {
        shipment: { select: pick },
        order: {
          select: {
            orderShipments: {
              where: { shipment: { awbNumber: { not: null } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { shipment: { select: pick } },
            },
          },
        },
      },
    });
    if (ticket === null) return null;
    const from = ticket.shipment ?? ticket.order?.orderShipments[0]?.shipment ?? null;
    if (from === null) return null;
    return {
      awbNumber: from.awbNumber,
      courierAccountId: from.courierAccountId,
      courierCode: from.courierCode,
    };
  }

  /**
   * The thread, for a seller or an operator.
   *
   * `sellerId` scopes it when a seller is asking — ownership is checked
   * through the ticket, not passed in by the caller, because a
   * seller-supplied id is exactly what an IDOR is.
   */
  async thread(escalationId: string, sellerId?: string): Promise<EscalationView> {
    const row = await this.prisma.client.courierEscalation.findUnique({
      where: { id: escalationId },
      select: {
        id: true,
        ticketId: true,
        externalTicketId: true,
        awbNumber: true,
        courierCode: true,
        state: true,
        lastMessageAt: true,
        needsReviewAt: true,
        ticket: { select: { sellerId: true } },
        messages: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            direction: true,
            channel: true,
            body: true,
            occurredAt: true,
            state: true,
            templateCode: true,
            needsReview: true,
          },
        },
        outbox: {
          where: { status: { in: ['PENDING', 'SENDING', 'SENT_UNCONFIRMED'] } },
          select: { id: true },
        },
      },
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'ESCALATION_NOT_FOUND',
        message: 'No such escalation.',
      });
    }
    if (sellerId !== undefined && row.ticket.sellerId !== sellerId) {
      // Same body as a miss would give: whether an escalation exists is
      // not something another seller should be able to probe.
      throw new NotFoundException({
        code: 'ESCALATION_NOT_FOUND',
        message: 'No such escalation.',
      });
    }

    return {
      id: row.id,
      ticketId: row.ticketId,
      externalTicketId: row.externalTicketId,
      awbNumber: row.awbNumber,
      courierCode: row.courierCode,
      state: row.state,
      lastMessageAt: row.lastMessageAt,
      needsReviewAt: row.needsReviewAt,
      pendingOutbound: row.outbox.length,
      messages: row.messages,
    };
  }

  /** The escalation for a ticket, or null. Used to link from a ticket view. */
  async forTicket(ticketId: string, sellerId?: string): Promise<EscalationView | null> {
    const row = await this.prisma.client.courierEscalation.findUnique({
      where: { ticketId },
      select: { id: true },
    });
    if (row === null) return null;
    return this.thread(row.id, sellerId);
  }

  /**
   * A seller's (or operator's) message to the courier.
   *
   * Two writes, in this order: the OUTBOUND message row so the thread
   * shows it immediately, then the outbox item that will actually deliver
   * it. Visible-vs-silent: if the enqueue fails, the seller can see their
   * message sitting in the thread un-delivered, which is recoverable and
   * obvious. The reverse order would deliver words that never appeared in
   * the conversation they came from.
   *
   * The body is stored and sent VERBATIM. The classifier labels it for
   * badges; it never edits what anyone wrote.
   */
  /**
   * Record what the courier actually said, typed in by an operator.
   *
   * The other half of the MANUAL channel. Outbound already works — a
   * message is drafted, an operator claims it and sends it in
   * Delhivery's own portal — but until now their ANSWER had nowhere to
   * go except the inbound-email pipeline, which needs a mailbox that is
   * not configured. So the conversation was one-way: the seller could
   * ask and never be told.
   *
   * Deliberately NOT put through the classifier. Classification exists
   * to triage machine-received email nobody has read; an operator
   * pasting a reply has already read it, and labelling their judgement
   * with a confidence score would be inventing uncertainty. The message
   * is marked as needing no review for the same reason.
   *
   * It does NOT enqueue anything: this is a message COMING IN. Sending
   * it back to the courier is what `postReply` is for.
   */
  async recordInbound(input: {
    escalationId: string;
    body: string;
    staffId: string;
    occurredAt?: Date;
  }): Promise<{ messageId: string }> {
    const trimmed = input.body.trim();
    if (trimmed === '') {
      throw new ForbiddenException({
        code: 'EMPTY_MESSAGE',
        message: 'A message needs some text.',
      });
    }
    const view = await this.thread(input.escalationId);
    // When they said it, not when it was typed up — an operator may be
    // catching up on yesterday's replies, and a timeline that reorders
    // itself around data entry is not a record of the conversation.
    const occurredAt = input.occurredAt ?? new Date();

    const message = await this.prisma.client.courierEscalationMessage.create({
      data: {
        escalationId: view.id,
        direction: CourierMessageDirection.INBOUND,
        channel: CourierMessageChannel.MANUAL,
        body: trimmed,
        bodyHash: this.classifier.hashBody(trimmed),
        minuteBucket: minuteBucketOf(occurredAt),
        occurredAt,
        needsReview: false,
      },
      select: { id: true },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      action: 'courier.escalation.inbound_recorded',
      entityType: 'courier_escalation',
      entityId: view.id,
      // The seller reads this as the courier's own words, so who typed
      // it in is worth being able to find later.
      severity: 'MEDIUM',
      metadata: { messageId: message.id, occurredAt: occurredAt.toISOString() },
    });

    return { messageId: message.id };
  }

  async postReply(input: {
    escalationId: string;
    body: string;
    sellerId?: string;
    staffId?: string;
  }): Promise<{ messageId: string; outboxItemId: string | null }> {
    const trimmed = input.body.trim();
    if (trimmed === '') {
      throw new ForbiddenException({
        code: 'EMPTY_MESSAGE',
        message: 'A message needs some text.',
      });
    }

    // Ownership via the ticket, and it throws the generic not-found.
    const view = await this.thread(input.escalationId, input.sellerId);

    const occurredAt = new Date();
    const message = await this.prisma.client.courierEscalationMessage.create({
      data: {
        escalationId: view.id,
        direction: CourierMessageDirection.OUTBOUND,
        channel: CourierMessageChannel.MANUAL,
        body: trimmed,
        bodyHash: this.classifier.hashBody(trimmed),
        minuteBucket: minuteBucketOf(occurredAt),
        occurredAt,
        // Outbound text is OURS. Classifying it would label our own words
        // with a courier state and pollute the escalation's state.
        needsReview: false,
      },
      select: { id: true },
    });

    let outboxItemId: string | null = null;
    try {
      const kind =
        view.externalTicketId === null ? CourierOutboxKind.RAISE_TICKET : CourierOutboxKind.COMMENT;
      const item = await this.outbox.enqueue({
        escalationId: view.id,
        kind,
        body: trimmed,
      });
      outboxItemId = item.id;
    } catch (err) {
      // The message is already visible in the thread; the delivery is
      // what failed. Logged rather than thrown so the seller is not told
      // their message vanished when it did not.
      this.logger.error(
        { escalationId: view.id, err: err instanceof Error ? err.message : String(err) },
        'Reply stored but could not be enqueued for delivery',
      );
    }

    await this.audit.log({
      actorType: input.staffId === undefined ? ActorType.SELLER : ActorType.STAFF,
      sellerId: input.sellerId ?? null,
      staffUserId: input.staffId ?? null,
      action: 'courier.escalation.reply_queued',
      entityType: 'courier_escalation',
      entityId: view.id,
      severity: 'LOW',
      // The fingerprint, not the text: the body already lives in the
      // message row, and copying it here would put customer-adjacent
      // wording in two places with two retention stories.
      metadata: {
        messageId: message.id,
        outboxItemId,
        bodyHash: this.classifier.hashBody(trimmed),
      },
    });

    return { messageId: message.id, outboxItemId };
  }
}
