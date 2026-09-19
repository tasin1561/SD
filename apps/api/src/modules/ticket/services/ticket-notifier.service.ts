import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationRecipientType,
  type Prisma,
} from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';
import { SellerNotificationPreferenceResolver } from '../../seller-notification-preference/services/seller-notification-preference-resolver.service';
import { StoreNotificationSender } from '../../notification-audience/services/store-notification-sender.service';
import {
  inAppBody,
  planTicketNotification,
  sellerCategoryFor,
  TICKETS_VIEW_PERMISSION,
  type SellerNotice,
  type StaffNotice,
  type StoreNotice,
} from './ticket-notification-plan';

/**
 * Waits, in ms, for the event to become visible. The first read is
 * immediate — every caller outside a transaction has already committed.
 * The rest are for the one caller that is still INSIDE its transaction
 * when it hands us the event (the RTO inspection opens its scrap ticket
 * in its own tx): once that commits, a later read sees the row. An event
 * never seen is a rolled-back write, and nothing is sent for it.
 */
const COMMIT_WAITS_MS = [0, 100, 400, 1500, 4000] as const;

const EVENT_SELECT = {
  id: true,
  fromStatus: true,
  toStatus: true,
  note: true,
  actorType: true,
  ticket: {
    select: {
      id: true,
      ticketNumber: true,
      ticketType: true,
      subject: true,
      description: true,
      resolutionAmountInr: true,
      sellerId: true,
      orderId: true,
      seller: { select: { companyName: true, email: true } },
      // RS-7 — a store dispute names the store and, once settled, who paid.
      storeId: true,
      store: { select: { name: true, displayName: true } },
      disputePayer: true,
    },
  },
} as const;

/**
 * TKT-3 — tells the other side of a ticket that something happened on it.
 *
 * `TicketService` wrote every ticket event and told nobody: a seller
 * found out we had opened a scrap ticket, replied, or refunded them only
 * by opening the tickets page, and staff found a seller's new issue the
 * same way. This is the telling. WHAT is sent is decided by the pure
 * `planTicketNotification`; this only loads the facts and delivers.
 *
 *   - The SELLER: in-app to the people there who can see tickets
 *     (`SELLER_PERMISSION tickets.view`, NOTIF-14), and an email to the
 *     COMPANY address through the ledger (NOTIF-2 store-then-send). Both
 *     gated by the company's own per-category preference (NOTIF-15);
 *     each person may silence the in-app topic (NOTIF-17). OPERATIONAL,
 *     never CREDENTIAL (NOTIF-9).
 *   - STAFF: in-app, addressed by the permission that opens the queue
 *     (`STAFF_PERMISSION tickets.view`, NOTIF-10).
 *
 * POST-COMMIT, FIRE-AND-FORGET, NEVER THROWS. The ticket event is the
 * durable fact; a notification is a reflection of it, and a failure here
 * must never fail — or roll back — the write it describes (NOTIF-1).
 * Every delivery carries `ticket:<ticketEventId>` so a repeat is refused
 * by the NOTIF-2 partial unique rather than sent twice. The in-flight
 * work is tracked and drained (NOTIF-19): `resetAuthState` awaits it.
 */
@Injectable()
export class TicketNotifier implements OnModuleDestroy {
  private readonly logger = new Logger(TicketNotifier.name);
  private readonly inFlight = new Set<Promise<void>>();
  /** The read-back schedule. A field only so a unit test can shorten it. */
  commitWaitsMs: readonly number[] = COMMIT_WAITS_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
    private readonly ledger: NotificationLedgerService,
    private readonly preferences: SellerNotificationPreferenceResolver,
    private readonly env: EnvService,
    // RS-7's third party finally hears about its own ticket (2026-09-19).
    private readonly store: StoreNotificationSender,
  ) {}

  /** Queue the telling for one ticket event. Returns at once. */
  afterEvent(ticketEventId: string): void {
    const work = this.run(ticketEventId)
      .catch((err: unknown) => {
        this.logger.warn(
          { ticketEventId, err: err instanceof Error ? err.message : String(err) },
          'Ticket notification failed — the ticket itself is unaffected',
        );
      })
      .finally(() => {
        this.inFlight.delete(work);
      });
    this.inFlight.add(work);
  }

  /** Awaited by the e2e reset between tests, and at shutdown. */
  async drainInFlight(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.drainInFlight();
  }

  /** Exposed for the unit tests; `afterEvent` is the production entry. */
  async run(ticketEventId: string): Promise<void> {
    const event = await this.loadCommitted(ticketEventId);
    if (event === null) {
      this.logger.debug({ ticketEventId }, 'Ticket event never became visible — nothing to tell');
      return;
    }
    const t = event.ticket;
    const plan = planTicketNotification(
      {
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        actorType: event.actorType,
      },
      {
        ticketNumber: t.ticketNumber,
        ticketType: t.ticketType,
        subject: t.subject,
        description: t.description,
        resolutionAmountInr: t.resolutionAmountInr?.toFixed(2) ?? null,
        companyName: t.seller.companyName,
        storeName: t.store?.displayName ?? t.store?.name ?? null,
        disputePayer: t.disputePayer ?? null,
      },
    );
    if (plan.seller !== null) await this.tellSeller(ticketEventId, t, plan.seller);
    if (plan.staff !== null) await this.tellStaff(ticketEventId, t, plan.staff);
    if (plan.store !== null && t.storeId !== null) {
      await this.tellStore(ticketEventId, t, t.storeId, plan.store);
    }
  }

  private async loadCommitted(ticketEventId: string): Promise<EventRow | null> {
    for (const wait of this.commitWaitsMs) {
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const row = await this.prisma.client.ticketEvent.findUnique({
        where: { id: ticketEventId },
        select: EVENT_SELECT,
      });
      if (row !== null) return row;
    }
    return null;
  }

  private async tellSeller(
    ticketEventId: string,
    t: EventRow['ticket'],
    notice: SellerNotice,
  ): Promise<void> {
    const pref = await this.preferences.resolve({
      sellerId: t.sellerId,
      category: sellerCategoryFor(t.ticketType),
      notificationCategory: NotificationCategory.OPERATIONAL,
    });
    const triggerEvent = `ticket.${notice.kind.toLowerCase()}`;

    // In-app first and independently: the company switching a category's
    // EMAIL off must not silence its inbox line (NOTIF-15).
    if (pref.inApp) {
      try {
        await this.dispatch.dispatch({
          topic: notice.topic,
          category: NotificationCategory.OPERATIONAL,
          title: notice.title,
          body: inAppBody(notice),
          channels: [NotificationChannel.IN_APP],
          audience: [
            {
              kind: 'SELLER_PERMISSION',
              sellerId: t.sellerId,
              permission: TICKETS_VIEW_PERMISSION,
            },
          ],
          triggerEvent,
          orderId: t.orderId,
          eventId: `ticket:${ticketEventId}:inapp`,
        });
      } catch (err) {
        this.logger.warn(
          { ticketEventId, err: err instanceof Error ? err.message : String(err) },
          'Ticket in-app notice failed; the email leg is unaffected',
        );
      }
    }

    if (!pref.email) return;
    try {
      await this.ledger.enqueue({
        eventId: `ticket:${ticketEventId}`,
        recipientType: NotificationRecipientType.SELLER,
        recipientId: t.sellerId,
        channel: NotificationChannel.EMAIL,
        templateCode: notice.emailTemplate,
        locale: 'en',
        toEmail: t.seller.email,
        variables: {
          company_name: t.seller.companyName,
          ticket_number: t.ticketNumber,
          ticket_subject: t.subject,
          message: notice.body,
          ticket_url: `${this.env.sellerAppUrl}/tickets/${t.id}`,
          app_url: this.env.sellerAppUrl,
        },
        orderId: t.orderId,
        shipmentId: null,
        triggerEvent,
        sendDelayMs: pref.emailDelayMs,
      });
    } catch (err) {
      this.logger.warn(
        { ticketEventId, err: err instanceof Error ? err.message : String(err) },
        'Ticket email could not be queued',
      );
    }
  }

  private async tellStaff(
    ticketEventId: string,
    t: EventRow['ticket'],
    notice: StaffNotice,
  ): Promise<void> {
    await this.dispatch.dispatch({
      topic: notice.topic,
      category: NotificationCategory.OPERATIONAL,
      title: notice.title,
      body: notice.body,
      channels: [NotificationChannel.IN_APP],
      audience: [{ kind: 'STAFF_PERMISSION', permission: TICKETS_VIEW_PERMISSION }],
      triggerEvent: notice.topic,
      orderId: t.orderId,
      eventId: `ticket:${ticketEventId}:staff`,
    });
  }

  /**
   * The reseller store's own copy of what happened on its ticket
   * (2026-09-19).
   *
   * ── WHY THIS DID NOT EXIST ───────────────────────────────────────────
   * RS-7 gave a store the right to raise a dispute with its seller and
   * have Skydrop referee it, and the plan said so in as many words: "A
   * store has no inbox yet, so nothing is sent TO the store; it reads the
   * ticket on its own portal." That made the store the only party to a
   * three-sided conversation who had to go looking — including when the
   * settlement moved money between its wallet and the seller's.
   *
   * ── NOT GATED BY A COMPANY PREFERENCE ────────────────────────────────
   * The seller's legs are gated by `SellerNotificationPreferenceResolver`
   * because a ticket about their goods is filed under one of THEIR
   * categories. A store's ticket is the store's own, and its category
   * switch lives on its own preferences — applied inside the dispatcher
   * (`StoreNotificationPreferenceService`), which is where every store
   * message passes through it. Asking here as well would be a second
   * reader of the same decision.
   */
  private async tellStore(
    ticketEventId: string,
    t: EventRow['ticket'],
    storeId: string,
    notice: StoreNotice,
  ): Promise<void> {
    await this.store.tell({
      storeId,
      topic: notice.topic,
      templateCode: notice.emailTemplate,
      eventId: `ticket:${ticketEventId}:store`,
      title: notice.title,
      body: inAppBody({
        kind: 'REPLY',
        topic: notice.topic,
        emailTemplate: notice.emailTemplate,
        title: notice.title,
        body: notice.body,
      }),
      variables: {
        store_name: t.store?.displayName ?? t.store?.name ?? '',
        ticket_number: t.ticketNumber,
        ticket_subject: t.subject,
        message: notice.body,
        ticket_url: `${this.env.resellerAppUrl}/tickets/${t.id}`,
      },
      orderId: t.orderId,
      triggerEvent: notice.topic,
      // Whoever at the store can see its tickets — the same permission
      // that opens the queue, on the store's own catalogue.
      permissions: [TICKETS_VIEW_PERMISSION],
      ref: ticketEventId,
    });
  }
}

type EventRow = Prisma.TicketEventGetPayload<{ select: typeof EVENT_SELECT }>;
