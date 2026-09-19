import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { StoreNotificationSender } from '../../notification-audience/services/store-notification-sender.service';

/** The store-user emails (NOTIF-14: the code without `.email`). */
export const STORE_REQUEST_APPROVED_TEMPLATE = 'store.request_approved.email';
export const STORE_REQUEST_REJECTED_TEMPLATE = 'store.request_rejected.email';
export const STORE_REQUEST_EXPIRED_TEMPLATE = 'store.request_expired.email';
export const STORE_ORDER_CHANGED_BY_SELLER_TEMPLATE = 'store.order_changed_by_seller.email';
export const STORE_CUSTOMER_CHANGED_BY_SELLER_TEMPLATE = 'store.customer_changed_by_seller.email';
/** SKYDROP changed the order's money through god mode (ORD-2). */
export const STORE_ORDER_CHANGED_BY_ADMIN_TEMPLATE = 'store.order_changed_by_admin.email';

/**
 * The STORE-side in-app topics the same five messages carry since
 * 2026-09-19 — each the email's code without `.email` (NOTIF-14).
 */
export const STORE_REQUEST_APPROVED_TOPIC = 'store.request_approved';
export const STORE_REQUEST_REJECTED_TOPIC = 'store.request_rejected';
export const STORE_REQUEST_EXPIRED_TOPIC = 'store.request_expired';
export const STORE_ORDER_CHANGED_BY_SELLER_TOPIC = 'store.order_changed_by_seller';
export const STORE_CUSTOMER_CHANGED_BY_SELLER_TOPIC = 'store.customer_changed_by_seller';

/**
 * The seller-side topics this notifier sends (NOTIF-17 — pinned against
 * the catalogue by `notification-topic-catalog.service.spec.ts`).
 */
export const STORE_REQUEST_WAITING_TOPIC = 'seller.store_request_waiting';
export const STORE_REQUEST_REMINDER_TOPIC = 'seller.store_request_reminder';
/** The store changed one of its own orders, or its customer's record. */
export const STORE_CHANGED_ORDER_TOPIC = 'seller.store_changed_order';
/** SKYDROP changed the money on a reseller order (god mode, ORD-2). */
export const ADMIN_CHANGED_ORDER_MONEY_TOPIC = 'seller.store_order_money_changed_by_admin';

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
 * The STORE hears on BOTH channels since 2026-09-19 — it has an inbox
 * now, and the same message goes to each through
 * `StoreNotificationSender`, the emails byte-identical to what they
 * were. Four of the five can never be silenced (`IMMUTABLE_TOPICS`):
 * three are answers to something the store asked, and the fourth is
 * somebody else changing one of its orders. SELLER STAFF hear in-app,
 * addressed by PERMISSION (NOTIF-10).
 *
 * NEVER THROWS (NOTIF-1): the request and its decision are the durable
 * facts. Awaited by callers, never fire-and-forget, so the e2e reset has
 * no in-flight write to drain (NOTIF-19).
 */
@Injectable()
export class StoreRequestNotifier {
  private readonly logger = new Logger(StoreRequestNotifier.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly store: StoreNotificationSender,
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
    const note = input.decisionNote === null ? '' : ` They said: “${input.decisionNote}”.`;
    await this.tellStore({
      storeId: input.storeId,
      ref: input.requestId,
      topic: input.approved ? STORE_REQUEST_APPROVED_TOPIC : STORE_REQUEST_REJECTED_TOPIC,
      templateCode: input.approved
        ? STORE_REQUEST_APPROVED_TEMPLATE
        : STORE_REQUEST_REJECTED_TEMPLATE,
      eventId: `store_request_decided:${input.requestId}:${suffix}`,
      title: input.approved
        ? `${input.sellerName} agreed — ${input.orderNumber}`
        : `${input.sellerName} said no — ${input.orderNumber}`,
      body:
        `You asked ${input.sellerName} to approve this on order ${input.orderNumber}: ` +
        `${input.label}. ` +
        (input.approved ? 'They agreed.' : 'They said no.') +
        note +
        (input.outcome === '' ? '' : ` ${input.outcome}`),
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
    await this.tellStore({
      storeId: input.storeId,
      ref: input.requestId,
      topic: STORE_REQUEST_EXPIRED_TOPIC,
      templateCode: STORE_REQUEST_EXPIRED_TEMPLATE,
      eventId: `store_request_expired:${input.requestId}`,
      title: `Nobody answered — ${input.orderNumber}`,
      body:
        `Your request on order ${input.orderNumber} (${input.label}) went unanswered for ` +
        `${input.expireHours} hours, so it closed itself. The order kept what it already had. ` +
        `You can ask ${input.sellerName} again.`,
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
   * The RESELLER STORE changed one of its own orders (owner, 2026-09-18).
   *
   * Seller staff own the goods, the warehouse slot and the courier, so
   * they hear about it every time — in-app, addressed by PERMISSION
   * (NOTIF-10), with the old value beside the new one and the money's
   * before and after when it moved. The mirror of
   * `orderChangedBySeller`: whoever did NOT make the change is told.
   */
  async orderChangedByStore(input: {
    sellerId: string;
    /** The edit, so a retry of the same one cannot notify twice. */
    eventKey: string;
    orderId: string;
    orderNumber: string;
    storeName: string;
    changes: string;
    money: string;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: STORE_CHANGED_ORDER_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `“${input.storeName}” changed order ${input.orderNumber}`,
        body:
          `${input.storeName} changed one of its orders. What moved:\n${input.changes}` +
          (input.money === '' ? '' : `\n\n${input.money}`),
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.order_changed_by_store',
        eventId: `store_order_changed:${input.eventKey}:inapp`,
        orderId: input.orderId,
      });
    } catch (err) {
      this.warn('Could not tell seller staff a store changed its order', input.eventKey, err);
    }
  }

  /**
   * The RESELLER STORE changed its own customer's record. Same rule:
   * seller staff read that customer on their own screens and ring them
   * about failed deliveries (ORD-7 amended), so they hear about it.
   */
  async customerChangedByStore(input: {
    sellerId: string;
    eventKey: string;
    storeName: string;
    customerName: string;
    changes: string;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: STORE_CHANGED_ORDER_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `“${input.storeName}” changed a customer’s details`,
        body: `${input.storeName} changed what we hold for ${input.customerName}:\n${input.changes}`,
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.customer_changed_by_store',
        eventId: `store_customer_changed:${input.eventKey}:inapp`,
      });
    } catch (err) {
      this.warn('Could not tell seller staff a store changed a customer', input.eventKey, err);
    }
  }

  /**
   * SELLER STAFF changed a reseller store's order (owner, 2026-09-18) —
   * anything on it, not only the recipient. Replaces the narrower
   * `recipientChangedBySeller`, which said "the delivery details" and
   * would now be a lie about half the edits it is sent for.
   */
  async orderChangedBySeller(input: {
    storeId: string;
    eventKey: string;
    orderId: string;
    orderNumber: string;
    sellerName: string;
    changes: string;
    money: string;
    supersededRequest: boolean;
  }): Promise<void> {
    await this.tellStore({
      storeId: input.storeId,
      ref: input.eventKey,
      topic: STORE_ORDER_CHANGED_BY_SELLER_TOPIC,
      templateCode: STORE_ORDER_CHANGED_BY_SELLER_TEMPLATE,
      eventId: `store_order_changed_by_seller:${input.eventKey}`,
      title: `${input.sellerName} changed order ${input.orderNumber}`,
      body:
        `${input.sellerName} changed one of your orders. What moved:\n${input.changes}` +
        (input.money === '' ? '' : `\n\n${input.money}`) +
        (input.supersededRequest
          ? '\n\nThe change you had sent them for approval on this order has been closed — ' +
            'what is above is what the order now carries.'
          : ''),
      orderId: input.orderId,
      triggerEvent: 'reseller_store.order_changed_by_seller',
      variables: {
        seller_name: input.sellerName,
        order_number: input.orderNumber,
        changes: input.changes,
        money: input.money,
        superseded_note: input.supersededRequest
          ? 'The change you had sent them for approval on this order has been closed — what is above is what the order now carries.'
          : '',
      },
    });
  }

  /**
   * SKYDROP changed the money on a reseller order — god mode (ORD-2).
   *
   * The 2026-09-18 rule is "whoever did not make the change is told".
   * When a Skydrop admin forces a change, NEITHER party made it, so both
   * are the other side and both hear: the store by email, seller staff
   * in-app, exactly as an ordinary edit reaches them.
   *
   * Its own template and its own topic rather than
   * `orderChangedBySeller` with the name swapped: a store told "your
   * seller changed the cash to collect" would ring the seller about
   * something the seller did not do, which is the same false record the
   * codebase refuses everywhere else it attributes an action.
   */
  async orderChangedByAdmin(input: {
    sellerId: string;
    storeId: string;
    eventKey: string;
    orderId: string;
    orderNumber: string;
    changes: string;
    money: string;
  }): Promise<void> {
    await this.emailStore(input.storeId, input.eventKey, {
      eventId: `store_order_changed_by_admin:${input.eventKey}`,
      templateCode: STORE_ORDER_CHANGED_BY_ADMIN_TEMPLATE,
      orderId: input.orderId,
      triggerEvent: 'reseller_store.order_changed_by_admin',
      variables: {
        order_number: input.orderNumber,
        changes: input.changes,
        money: input.money,
      },
    });
    try {
      await this.dispatch.dispatch({
        topic: ADMIN_CHANGED_ORDER_MONEY_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `Skydrop changed the money on order ${input.orderNumber}`,
        body:
          `Skydrop changed order ${input.orderNumber} directly. What moved:\n${input.changes}` +
          (input.money === '' ? '' : `\n\n${input.money}`),
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.order_changed_by_admin',
        eventId: `store_order_changed_by_admin:${input.eventKey}:inapp`,
        orderId: input.orderId,
      });
    } catch (err) {
      this.warn('Could not tell seller staff Skydrop changed a store order', input.eventKey, err);
    }
  }

  /**
   * SELLER STAFF changed a customer record belonging to one of their
   * reseller stores (owner, 2026-09-18). The store spoke to that person;
   * it must not find out from the customer.
   */
  async customerChangedBySeller(input: {
    storeId: string;
    eventKey: string;
    sellerName: string;
    customerName: string;
    changes: string;
  }): Promise<void> {
    await this.tellStore({
      storeId: input.storeId,
      ref: input.eventKey,
      topic: STORE_CUSTOMER_CHANGED_BY_SELLER_TOPIC,
      templateCode: STORE_CUSTOMER_CHANGED_BY_SELLER_TEMPLATE,
      eventId: `store_customer_changed_by_seller:${input.eventKey}`,
      title: `${input.sellerName} changed a customer’s details`,
      body: `${input.sellerName} changed what we hold for ${input.customerName}:\n${input.changes}`,
      orderId: null,
      triggerEvent: 'reseller_store.customer_changed_by_seller',
      variables: {
        seller_name: input.sellerName,
        customer_name: input.customerName,
        changes: input.changes,
      },
    });
  }

  /**
   * One message to the store, on both channels.
   *
   * The private `emailStore` this replaces resolved the store's people
   * itself and looped enqueueing; three notifiers had the same twenty
   * lines. `StoreNotificationSender` is the ONE place now, so the
   * audience, the store's own category switch and each person's mute are
   * decided once for the pair rather than separately per leg.
   */
  private async tellStore(input: {
    storeId: string;
    ref: string;
    topic: string;
    templateCode: string;
    eventId: string;
    title: string;
    body: string;
    orderId: string | null;
    triggerEvent: string;
    variables: Record<string, string>;
  }): Promise<void> {
    await this.store.tell({
      storeId: input.storeId,
      topic: input.topic,
      templateCode: input.templateCode,
      eventId: input.eventId,
      title: input.title,
      body: input.body,
      variables: input.variables,
      orderId: input.orderId,
      triggerEvent: input.triggerEvent,
      permissions: STORE_ORDER_PERMISSIONS,
      ref: input.ref,
    });
  }

  private warn(what: string, ref: string, err: unknown): void {
    this.logger.warn({ ref, err: err instanceof Error ? err.message : err }, what);
  }
}
