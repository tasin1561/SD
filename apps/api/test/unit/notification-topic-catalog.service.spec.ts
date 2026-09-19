import {
  NotificationRecipientType,
  NotificationSubjectType,
  OrderStatus,
  StoreNotificationCategory,
  SystemIssueKind,
} from '@skydrop/db';
import {
  NotificationTopicCatalogService,
  SELLER_TOPICS,
  STAFF_TOPICS,
  STORE_TOPICS,
  topicForIssue,
} from '../../src/modules/notification-audience/services/notification-topic-catalog.service';
import { IMMUTABLE_TOPICS } from '../../src/modules/notification-audience/services/notification-policy.service';
import {
  STORE_ACTION_APPROVED_TOPIC,
  STORE_ACTION_REJECTED_TOPIC,
} from '../../src/modules/delivery-action/services/store-action-notifier.service';
import {
  STORE_ADDRESS_CHANGE_APPROVED_TOPIC,
  STORE_ADDRESS_CHANGE_REJECTED_TOPIC,
} from '../../src/modules/reseller-order/services/address-change-notifier.service';
import { STORE_TERMS_PUBLISHED_TOPIC } from '../../src/modules/reseller-store-terms/services/reseller-terms-notifier.service';
import {
  STORE_TICKET_REPLY_TOPIC,
  STORE_TICKET_RESOLVED_TOPIC,
} from '../../src/modules/ticket/services/ticket-notification-plan';
import { NotificationEventMappingService } from '../../src/modules/notifications/services/notification-event-mapping.service';
import { permissionsFor } from '../../src/modules/system-issues/services/system-issue-notifier.service';
import { WITHDRAWAL_AUTO_REJECTED_TOPIC } from '../../src/modules/seller-wallet-withdrawal/services/unpayable-withdrawal.service';
import {
  TICKET_OPENED_FOR_YOU_TOPIC,
  TICKET_REPLY_TOPIC,
  TICKET_RESOLVED_TOPIC,
  TICKET_SELLER_OPENED_TOPIC,
  TICKET_SELLER_REPLIED_TOPIC,
} from '../../src/modules/ticket/services/ticket-notification-plan';
import { RECEIPT_SURPLUS_TOPIC } from '../../src/modules/inventory-receipt/services/receipt-shortfall-ticket.service';
import { GOODS_RECEIPT_DISCREPANCY_TOPIC } from '../../src/modules/inventory-receipt/services/goods-receipt.service';
import { ORDER_NEEDS_ATTENTION_TOPIC } from '../../src/modules/order-attention/services/order-attention.service';
import { STOCK_LOW_ALERT_TOPIC } from '../../src/modules/inventory-shared/stock-alert.service';
import { INVOICE_DELIVERED_TOPIC } from '../../src/modules/invoice/services/invoice.service';
import { TOPUP_SUBMITTED_TOPIC } from '../../src/modules/wallet-topup/services/wallet-topup.service';
import { INVITE_LEAD_TOPIC } from '../../src/modules/invite-lead/services/invite-lead.service';
import { RESELLER_STORE_PENDING_TOPIC } from '../../src/modules/reseller-store/services/reseller-store-notifier.service';
import { RESELLER_SET_ASIDE_SHRUNK_TOPIC } from '../../src/modules/reseller-catalogue/services/reseller-set-aside-notifier.service';
import { LABEL_REPRINT_REQUESTED_TOPIC } from '../../src/modules/consignment/services/label-reprint-request.service';
import {
  RESELLER_TERMS_ACCEPTED_TOPIC,
  RESELLER_TERMS_NEED_REVISION_TOPIC,
} from '../../src/modules/reseller-store-terms/services/reseller-terms-notifier.service';
import {
  RESELLER_STOCK_REORDER_TOPIC,
  RESELLER_STORE_AUTO_PAUSED_TOPIC,
} from '../../src/modules/reseller-reports/services/reseller-reports-notifier.service';
import { STORE_ADDRESS_CHANGE_WAITING_TOPIC } from '../../src/modules/reseller-order/services/address-change-notifier.service';
import { STORE_ACTION_WAITING_TOPIC } from '../../src/modules/delivery-action/services/store-action-notifier.service';
import {
  ADMIN_CHANGED_ORDER_MONEY_TOPIC,
  STORE_CHANGED_ORDER_TOPIC,
  STORE_CUSTOMER_CHANGED_BY_SELLER_TOPIC,
  STORE_ORDER_CHANGED_BY_ADMIN_TOPIC,
  STORE_ORDER_CHANGED_BY_SELLER_TOPIC,
  STORE_REQUEST_APPROVED_TOPIC,
  STORE_REQUEST_EXPIRED_TOPIC,
  STORE_REQUEST_REJECTED_TOPIC,
  STORE_REQUEST_REMINDER_TOPIC,
  STORE_REQUEST_WAITING_TOPIC,
} from '../../src/modules/store-order-request/services/store-request-notifier.service';

/**
 * Every topic a reseller STORE is sent, named by its SENDER's own
 * constant (2026-09-19) — the third direction of the same check the
 * seller and staff lists get. A topic on the store's settings page that
 * no notifier sends is a switch with nothing behind it; a topic a
 * notifier sends that is not listed cannot be chosen about on any screen.
 */
const STORE_SENDERS = [
  STORE_REQUEST_APPROVED_TOPIC,
  STORE_REQUEST_REJECTED_TOPIC,
  STORE_REQUEST_EXPIRED_TOPIC,
  STORE_ORDER_CHANGED_BY_SELLER_TOPIC,
  STORE_ORDER_CHANGED_BY_ADMIN_TOPIC,
  STORE_CUSTOMER_CHANGED_BY_SELLER_TOPIC,
  STORE_ACTION_APPROVED_TOPIC,
  STORE_ACTION_REJECTED_TOPIC,
  STORE_ADDRESS_CHANGE_APPROVED_TOPIC,
  STORE_ADDRESS_CHANGE_REJECTED_TOPIC,
  STORE_TERMS_PUBLISHED_TOPIC,
  STORE_TICKET_REPLY_TOPIC,
  STORE_TICKET_RESOLVED_TOPIC,
];

/** Seller topics sent by something other than the lifecycle listener,
 *  each named by its sender's own constant. */
const OTHER_SELLER_SENDERS = [
  WITHDRAWAL_AUTO_REJECTED_TOPIC,
  TICKET_OPENED_FOR_YOU_TOPIC,
  TICKET_REPLY_TOPIC,
  TICKET_RESOLVED_TOPIC,
  RECEIPT_SURPLUS_TOPIC,
  // RS-1: an admin-opened reseller store waiting on the seller.
  RESELLER_STORE_PENDING_TOPIC,
  // RS-3: the hourly sweep cut a reseller set-aside.
  RESELLER_SET_ASIDE_SHRUNK_TOPIC,
  // RS-4: a store accepted the seller's terms; stores needing new terms.
  RESELLER_TERMS_ACCEPTED_TOPIC,
  RESELLER_TERMS_NEED_REVISION_TOPIC,
  // RS-9: a store auto-paused on its return rate; stock running low.
  RESELLER_STORE_AUTO_PAUSED_TOPIC,
  RESELLER_STOCK_REORDER_TOPIC,
  // 2026-09-16: a store's address correction held for seller staff.
  STORE_ADDRESS_CHANGE_WAITING_TOPIC,
  // 2026-09-16: a store's delivery ask held for seller staff.
  STORE_ACTION_WAITING_TOPIC,
  // 2026-09-17: a store's held cancel / call-cap answer / issue, and the
  // one reminder about any held request.
  STORE_REQUEST_WAITING_TOPIC,
  STORE_REQUEST_REMINDER_TOPIC,
  // 2026-09-18: a store changed one of its own orders, or a customer.
  STORE_CHANGED_ORDER_TOPIC,
  // 2026-09-19: god mode changed the money on a reseller order.
  ADMIN_CHANGED_ORDER_MONEY_TOPIC,
  // 2026-09-20: the five standalone senders whose EMAIL leg was retired,
  // so the inbox is the only channel they arrive on now. Each is pinned
  // to its sender's own constant for the reason the rest of this list is
  // — a topic on the settings page that the dispatcher never looks up
  // reads to a person as a switch they flicked that did nothing.
  ORDER_NEEDS_ATTENTION_TOPIC,
  STOCK_LOW_ALERT_TOPIC,
  GOODS_RECEIPT_DISCREPANCY_TOPIC,
  INVOICE_DELIVERED_TOPIC,
  TOPUP_SUBMITTED_TOPIC,
];

/** Staff topics that are not system issues (TKT-3), by their sender's constant. */
const OTHER_STAFF_SENDERS = [
  TICKET_SELLER_OPENED_TOPIC,
  TICKET_SELLER_REPLIED_TOPIC,
  LABEL_REPRINT_REQUESTED_TOPIC,
  // 2026-09-20: a new invite request. Its email leg was retired, so for
  // anybody with an account this is the only channel it arrives on.
  INVITE_LEAD_TOPIC,
];

/**
 * The catalogue is a list of words, and words drift.
 *
 * It is DECLARED rather than derived because deriving it would mean
 * `notification-audience` importing `notifications`, which imports it —
 * a cycle, and the R3 rule says extract rather than `forwardRef`. There
 * is nothing to extract: the list is names for humans.
 *
 * So the guarantee is a test instead, in BOTH directions. A test can
 * import what a module cannot. Same technique as the M10 mapping/matrix
 * consistency suite (F6), and it catches the failure that matters: a
 * topic somebody silences on their settings page that the dispatcher
 * never looks up, which reads as a mute that does nothing.
 */
describe('NotificationTopicCatalogService', () => {
  const svc = new NotificationTopicCatalogService();
  const mapping = new NotificationEventMappingService();

  /** Every in-app topic the seller listener can actually send. */
  function sellerTopicsTheListenerSends(): Set<string> {
    const out = new Set<string>();
    for (const status of Object.values(OrderStatus)) {
      for (const t of mapping.resolveForOrderStatus(status)) {
        if (t.recipientType === NotificationRecipientType.SELLER && t.inApp !== undefined) {
          // The listener strips `.email` — the catalogue must use the
          // key that ends up on the row, not the one on the template.
          out.add(t.templateCode.replace(/\.email$/, ''));
        }
      }
    }
    return out;
  }

  it('every topic a seller can silence is one the listener actually sends', () => {
    // A topic in the catalogue that nothing sends is a switch with
    // nothing behind it — the same defect as the preferences screen
    // that stored settings nobody read.
    const sent = sellerTopicsTheListenerSends();
    // The seller topics sent by something other than the lifecycle
    // listener, each named by its sender's own constant.
    for (const t of OTHER_SELLER_SENDERS) sent.add(t);
    const orphaned = SELLER_TOPICS.map((t) => t.topic).filter((t) => !sent.has(t));
    expect(orphaned).toEqual([]);
  });

  it('the automatic withdrawal rejection can be silenced under the key it is sent on', () => {
    expect(SELLER_TOPICS.map((t) => t.topic)).toContain(WITHDRAWAL_AUTO_REJECTED_TOPIC);
  });

  it('every ticket notice can be silenced under the key it is sent on (TKT-3)', () => {
    const seller = SELLER_TOPICS.map((t) => t.topic);
    for (const t of OTHER_SELLER_SENDERS) expect(seller).toContain(t);
    const staff = STAFF_TOPICS.map((t) => t.topic);
    for (const t of OTHER_STAFF_SENDERS) expect(staff).toContain(t);
  });

  it('every in-app notification a seller receives is one they can silence', () => {
    // The other direction, and the one that bites: a notification with
    // no catalogue entry cannot be switched off through any screen.
    const listed = new Set(SELLER_TOPICS.map((t) => t.topic));
    const unlisted = [...sellerTopicsTheListenerSends()].filter((t) => !listed.has(t));
    expect(unlisted).toEqual([]);
  });

  it('every system-issue kind has a staff topic, keyed the way the notifier keys it', () => {
    const listed = new Set(STAFF_TOPICS.map((t) => t.topic));
    const missing = Object.values(SystemIssueKind)
      .map(topicForIssue)
      .filter((t) => !listed.has(t));
    expect(missing).toEqual([]);
    // And nothing extra: a staff topic with no issue kind behind it
    // never fires — unless a named sender sends it (TKT-3's tickets).
    const known = new Set([
      ...Object.values(SystemIssueKind).map(topicForIssue),
      ...OTHER_STAFF_SENDERS,
    ]);
    expect(STAFF_TOPICS.map((t) => t.topic).filter((t) => !known.has(t))).toEqual([]);
  });

  it('every staff topic has somebody who would be told about it', () => {
    // A topic whose audience is empty is a preference about a
    // notification that reaches nobody.
    for (const kind of Object.values(SystemIssueKind)) {
      expect(permissionsFor(kind).length).toBeGreaterThan(0);
    }
  });

  it('every topic a store can silence is one a notifier actually sends', () => {
    const sent = new Set(STORE_SENDERS);
    const orphaned = STORE_TOPICS.map((t) => t.topic).filter((t) => !sent.has(t));
    expect(orphaned).toEqual([]);
  });

  it('every message a store is sent is one it can find on its settings page', () => {
    // The other direction, and the one that bites: a notification with
    // no catalogue entry cannot be switched off through any screen, and
    // the store's settings page would not even name it.
    const listed = new Set(STORE_TOPICS.map((t) => t.topic));
    expect(STORE_SENDERS.filter((t) => !listed.has(t))).toEqual([]);
  });

  it('a store topic is the email template code without `.email` (NOTIF-14)', () => {
    // The two legs of one notification are silenced by different people
    // — the person for the bell, the store for the category — so they
    // must not share a key, and the in-app one is the email's minus the
    // suffix. A topic ending in `.email` means somebody keyed the inbox
    // leg on the email's code.
    for (const t of STORE_TOPICS) expect(t.topic.endsWith('.email')).toBe(false);
  });

  it('the owner\u2019s three unsilenceable kinds are locked, and say why', () => {
    const store = svc.forSubject(NotificationSubjectType.STORE_USER);
    const locked = store.filter((t) => !t.mutable).map((t) => t.topic);
    // Decisions on its requests, anything about its money, and changes
    // to its orders (owner, 2026-09-19).
    expect([...locked].sort()).toEqual(
      [
        STORE_ACTION_APPROVED_TOPIC,
        STORE_ACTION_REJECTED_TOPIC,
        STORE_ADDRESS_CHANGE_APPROVED_TOPIC,
        STORE_ADDRESS_CHANGE_REJECTED_TOPIC,
        STORE_ORDER_CHANGED_BY_SELLER_TOPIC,
        STORE_ORDER_CHANGED_BY_ADMIN_TOPIC,
        STORE_REQUEST_APPROVED_TOPIC,
        STORE_REQUEST_EXPIRED_TOPIC,
        STORE_REQUEST_REJECTED_TOPIC,
        STORE_TICKET_RESOLVED_TOPIC,
      ].sort(),
    );
    // Locked with a REASON, in the same words the refusal uses — a
    // switch that always refuses teaches people to ignore refusals.
    for (const t of store.filter((x) => !x.mutable)) {
      expect(t.immutableReason ?? '').not.toBe('');
      expect(t.immutableReason).toBe(IMMUTABLE_TOPICS.get(t.topic));
    }
    // And something is still choosable, or the page is a list of locks.
    expect(store.filter((t) => t.mutable).length).toBeGreaterThan(0);
  });

  it('every store topic filed under MONEY can never be silenced', () => {
    // Vacuous today (no money topic is sent to a store yet) and binding
    // the moment one is added — which is the point: the owner named
    // money as one of the three kinds, and this makes the rule hold for
    // a topic nobody has written yet rather than for a list somebody
    // has to remember to extend.
    const money = STORE_TOPICS.filter((t) => t.category === StoreNotificationCategory.MONEY);
    expect(money.filter((t) => !IMMUTABLE_TOPICS.has(t.topic))).toEqual([]);
  });

  it('serves the right list per subject, and they do not overlap', () => {
    // BY TOPIC, not by array identity: since 2026-09-18 `forSubject`
    // decorates each entry with whether it can be silenced at all
    // (`IMMUTABLE_TOPICS`), so it returns new objects. The contract is
    // which topics each subject gets, which is what this asserts.
    expect(svc.forSubject(NotificationSubjectType.SELLER_USER).map((t) => t.topic)).toEqual(
      SELLER_TOPICS.map((t) => t.topic),
    );
    expect(svc.forSubject(NotificationSubjectType.STAFF_USER).map((t) => t.topic)).toEqual(
      STAFF_TOPICS.map((t) => t.topic),
    );
    expect(svc.forSubject(NotificationSubjectType.STORE_USER).map((t) => t.topic)).toEqual(
      STORE_TOPICS.map((t) => t.topic),
    );
    const seller = new Set(SELLER_TOPICS.map((t) => t.topic));
    expect(STAFF_TOPICS.filter((t) => seller.has(t.topic))).toEqual([]);
    // The store's list must not collide with either of the others: a
    // shared key would let one identity's mute silence another's.
    const storeKeys = new Set(STORE_TOPICS.map((t) => t.topic));
    expect(SELLER_TOPICS.filter((t) => storeKeys.has(t.topic))).toEqual([]);
    expect(STAFF_TOPICS.filter((t) => storeKeys.has(t.topic))).toEqual([]);
  });

  it('carries whether each topic can be silenced, so a screen need not guess', () => {
    // A switch the server always refuses teaches people to ignore
    // refusals; the flag travels with the list so the screen can render
    // it locked with the reason (FE-2 — the API still refuses).
    const seller = svc.forSubject(NotificationSubjectType.SELLER_USER);
    const reminder = seller.find((t) => t.topic === STORE_REQUEST_REMINDER_TOPIC);
    expect(reminder?.mutable).toBe(false);
    expect(reminder?.immutableReason).toContain('waiting a day');
    expect(seller.filter((t) => !t.mutable).map((t) => t.topic)).toEqual([
      STORE_REQUEST_REMINDER_TOPIC,
    ]);
    expect(svc.forSubject(NotificationSubjectType.STAFF_USER).every((t) => t.mutable)).toBe(true);
  });

  it('every entry is written for a person, not an enum', () => {
    for (const t of [...SELLER_TOPICS, ...STAFF_TOPICS, ...STORE_TOPICS]) {
      expect(t.label.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.group.length).toBeGreaterThan(2);
      // The label is what somebody reads next to a switch. If it is the
      // key again, the screen is still asking them to know codes.
      expect(t.label).not.toBe(t.topic);
    }
  });
});
