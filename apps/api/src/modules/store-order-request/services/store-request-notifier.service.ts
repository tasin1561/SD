import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, NotificationRecipientType } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';

/** The store-user emails (NOTIF-14: the code without `.email`). */
export const STORE_REQUEST_APPROVED_TEMPLATE = 'store.request_approved.email';
export const STORE_REQUEST_REJECTED_TEMPLATE = 'store.request_rejected.email';
export const STORE_REQUEST_EXPIRED_TEMPLATE = 'store.request_expired.email';
export const STORE_RECIPIENT_CHANGED_BY_SELLER_TEMPLATE = 'store.recipient_changed_by_seller.email';

/**
 * The seller-side topics this notifier sends (NOTIF-17 — pinned against
 * the catalogue by `notification-topic-catalog.service.spec.ts`).
 */
export const STORE_REQUEST_WAITING_TOPIC = 'seller.store_request_waiting';
export const STORE_REQUEST_REMINDER_TOPIC = 'seller.store_request_reminder';

/** Who at the seller hears about a store's request: whoever runs their stores. */
const STORES_MANAGE_PERMISSION = 'stores.manage';

/**
 * Store permissions whose holders act on orders, and so are the people a
 * decision about one of the store's requests is written to.
 */
const STORE_ORDER_PERMISSIONS = ['orders.actions', 'orders.cancel', 'tickets.manage'] as const;

/**
 * Telling each side about a reseller store's HELD request (2026-09-17).
 *
 * Covers the three pre-parcel kinds (`store_order_requests`), and — for
 * the expiry sweep, which closes every held queue — the reminder and the
 * expiry of a delivery action or address correction too, so that "nobody
 * answered" reads the same whichever queue it happened in.
 *
 * The STORE hears by EMAIL only: a reseller store has no inbox, so an
 * in-app leg would be written to a feed nobody there can open. SELLER
 * STAFF hear in-app, addressed by PERMISSION (NOTIF-10).
 *
 * NEVER THROWS (NOTIF-1): the request and its decision are the durable
 * facts. Awaited by callers, never fire-and-forget, so the e2e reset has
 * no in-flight write to drain (NOTIF-19).
 */
@Injectable()
export class StoreRequestNotifier {
  private readonly logger = new Logger(StoreRequestNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
    private readonly ledger: NotificationLedgerService,
    private readonly env: EnvService,
  ) {}

  /** A store asked for something seller staff must answer. */
  async waitingOnSeller(input: {
    sellerId: string;
    requestId: string;
    storeName: string;
    orderId: string;
    orderNumber: string;
    label: string;
    said: string | null;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: STORE_REQUEST_WAITING_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `“${input.storeName}” is waiting on you — ${input.label}`,
        body:
          `${input.storeName} asked you to approve this on order ${input.orderNumber}: ` +
          `${input.label}.` +
          (input.said === null || input.said === '' ? '' : ` They said: “${input.said}”.`) +
          ' Nothing happens until you answer.',
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.request_waiting',
        eventId: `store_request_waiting:${input.requestId}:inapp`,
        orderId: input.orderId,
      });
    } catch (err) {
      this.warn('Could not tell seller staff a store request is waiting', input.requestId, err);
    }
  }

  /**
   * A request has sat unanswered past the reminder threshold. Sent ONCE:
   * the sweep claims `seller_reminded_at` before calling this, and the
   * event id is the NOTIF-2 backstop.
   */
  async remindSeller(input: {
    sellerId: string;
    requestId: string;
    storeName: string;
    orderId: string;
    orderNumber: string;
    label: string;
    expiresInHours: number;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: STORE_REQUEST_REMINDER_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `Still waiting on you — ${input.storeName}, ${input.orderNumber}`,
        body:
          `${input.storeName} is still waiting for your answer on order ${input.orderNumber}: ` +
          `${input.label}. If nobody answers within about ${input.expiresInHours} more hours ` +
          'the request closes unanswered and the store is told.',
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.request_reminder',
        eventId: `store_request_reminder:${input.requestId}:inapp`,
        orderId: input.orderId,
      });
    } catch (err) {
      this.warn('Could not remind seller staff about a waiting request', input.requestId, err);
    }
  }

  /** Seller staff answered one of the three pre-parcel requests. */
  async decided(input: {
    storeId: string;
    requestId: string;
    approved: boolean;
    /** False when it was approved and then could not be carried out. */
    carriedOut: boolean;
    /** What happened, in a sentence the store can repeat to a customer. */
    outcome: string;
    orderId: string;
    orderNumber: string;
    sellerName: string;
    label: string;
    decisionNote: string | null;
  }): Promise<void> {
    const suffix = input.approved ? (input.carriedOut ? 'yes' : 'yes-failed') : 'no';
    await this.emailStore(input.storeId, input.requestId, {
      eventId: `store_request_decided:${input.requestId}:${suffix}`,
      templateCode: input.approved
        ? STORE_REQUEST_APPROVED_TEMPLATE
        : STORE_REQUEST_REJECTED_TEMPLATE,
      orderId: input.orderId,
      triggerEvent: 'reseller_store.request_decided',
      variables: {
        seller_name: input.sellerName,
        order_number: input.orderNumber,
        request_label: input.label,
        outcome: input.outcome,
        decision_note: input.decisionNote ?? '',
      },
    });
  }

  /** Nobody at the seller answered in time; the request was closed. */
  async expired(input: {
    storeId: string;
    requestId: string;
    orderId: string;
    orderNumber: string;
    sellerName: string;
    label: string;
    expireHours: number;
  }): Promise<void> {
    await this.emailStore(input.storeId, input.requestId, {
      eventId: `store_request_expired:${input.requestId}`,
      templateCode: STORE_REQUEST_EXPIRED_TEMPLATE,
      orderId: input.orderId,
      triggerEvent: 'reseller_store.request_expired',
      variables: {
        seller_name: input.sellerName,
        order_number: input.orderNumber,
        request_label: input.label,
        expire_hours: String(input.expireHours),
      },
    });
  }

  /**
   * Seller staff corrected the customer's details on one of the store's
   * orders themselves (owner decision, 2026-09-17). The store sold to this
   * customer and must know what the parcel now carries.
   */
  async recipientChangedBySeller(input: {
    storeId: string;
    /** The order event recording the edit — one email per edit. */
    eventKey: string;
    orderId: string;
    orderNumber: string;
    sellerName: string;
    changes: string;
    supersededRequest: boolean;
  }): Promise<void> {
    await this.emailStore(input.storeId, input.eventKey, {
      eventId: `store_recipient_changed_by_seller:${input.eventKey}`,
      templateCode: STORE_RECIPIENT_CHANGED_BY_SELLER_TEMPLATE,
      orderId: input.orderId,
      triggerEvent: 'reseller_store.recipient_changed_by_seller',
      variables: {
        seller_name: input.sellerName,
        order_number: input.orderNumber,
        changes: input.changes,
        superseded_note: input.supersededRequest
          ? 'The correction you had sent them for approval on this order has been closed — what is above is what the parcel now carries.'
          : '',
      },
    });
  }

  private async emailStore(
    storeId: string,
    ref: string,
    mail: {
      eventId: string;
      templateCode: string;
      orderId: string;
      triggerEvent: string;
      variables: Record<string, string>;
    },
  ): Promise<void> {
    try {
      const people = await this.prisma.client.storeUser.findMany({
        where: {
          storeId,
          deletedAt: null,
          role: {
            deletedAt: null,
            OR: [
              { isOwner: true },
              { permissions: { some: { permission: { in: [...STORE_ORDER_PERMISSIONS] } } } },
            ],
          },
        },
        select: { id: true, emailDisplay: true, fullName: true },
      });
      for (const person of people) {
        try {
          await this.ledger.enqueue({
            eventId: mail.eventId,
            recipientType: NotificationRecipientType.STORE_USER,
            recipientId: person.id,
            channel: NotificationChannel.EMAIL,
            templateCode: mail.templateCode,
            locale: 'en',
            toEmail: person.emailDisplay,
            variables: {
              full_name: person.fullName,
              ...mail.variables,
              order_url: `${this.env.resellerAppUrl}/orders/${mail.orderId}`,
              app_url: this.env.resellerAppUrl,
            },
            orderId: mail.orderId,
            shipmentId: null,
            triggerEvent: mail.triggerEvent,
          });
        } catch (err) {
          this.warn('An email to a store user could not be queued', ref, err);
        }
      }
    } catch (err) {
      this.warn('Could not email the store', ref, err);
    }
  }

  private warn(what: string, ref: string, err: unknown): void {
    this.logger.warn({ ref, err: err instanceof Error ? err.message : err }, what);
  }
}
