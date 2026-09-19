import { Injectable } from '@nestjs/common';
import { NotificationSubjectType, StoreNotificationCategory, SystemIssueKind } from '@skydrop/db';
import { IMMUTABLE_TOPICS } from './notification-policy.service';

export interface TopicDef {
  /** The stable key a subscription row is written against. */
  readonly topic: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
}

/**
 * A reseller store's topic, which additionally declares WHICH of the
 * store's own categories it belongs to (2026-09-19).
 *
 * Declared on the topic rather than in a second topic→category table,
 * for the reason NOTIF-15 gives for `sellerCategory` living on the
 * fan-out entry: a second table is a second thing to keep in step, and
 * the one that is not on the send path is the one that drifts.
 */
export interface StoreTopicDef extends TopicDef {
  readonly category: StoreNotificationCategory;
}

/**
 * A topic as a PERSON's settings screen reads it: the definition, plus
 * whether it can be silenced at all (2026-09-18).
 *
 * The flag travels with the list rather than being inferred client-side,
 * for the reason every other capability on this estate does: a screen
 * that offers a switch the server always refuses teaches people to
 * ignore refusals. FE-2 still holds — the switch is only rendered
 * locked, and the API is what actually refuses.
 */
export interface TopicView extends TopicDef {
  readonly mutable: boolean;
  /** Why it cannot be silenced, in the same words the refusal uses. */
  readonly immutableReason: string | null;
  /**
   * Which of the STORE's own categories this belongs to — present only
   * on a store topic, so the settings page can group a person's switches
   * under the same headings the store's own half uses, and say which
   * category a locked topic sits in.
   */
  readonly storeCategory?: StoreNotificationCategory;
}

/**
 * The topics a person can actually choose about.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Silencing something used to mean typing its code into a text box.
 * Nobody knows the codes, so in practice nothing was mutable and
 * `SUBSCRIBERS` — an audience of people who opted IN — could never
 * resolve anybody, because there was no way to opt in at all.
 *
 * ── WHY IT IS DECLARED RATHER THAN DERIVED ───────────────────────────
 * The seller list mirrors the in-app legs of `NotificationEventMapping`
 * Service (NOTIF-4) and the staff list mirrors `SystemIssueKind`.
 * Deriving them at runtime would mean this module importing
 * `notifications`, which imports this one — a cycle, and the R3 rule
 * says extract rather than `forwardRef`. There is nothing to extract
 * here: the list is words for humans, not behaviour.
 *
 * So it is declared, and `notification-topic-catalog.service.spec.ts`
 * pins it against both sources IN BOTH DIRECTIONS — a test can import
 * what a module cannot. Same technique as the M10 mapping/matrix
 * consistency suite (F6): two things that must agree, kept honest by a
 * test rather than by a dependency.
 */
@Injectable()
export class NotificationTopicCatalogService {
  forSubject(subjectType: NotificationSubjectType): readonly TopicView[] {
    return defsFor(subjectType).map((d) => ({
      ...d,
      mutable: !IMMUTABLE_TOPICS.has(d.topic),
      immutableReason: IMMUTABLE_TOPICS.get(d.topic) ?? null,
      // Only a STORE topic carries one. Spread-when-present rather than
      // `storeCategory: undefined`: under exactOptionalPropertyTypes an
      // explicit undefined is not the same as an absent key, and the
      // seller and staff lists have no category to give.
      ...(isStoreTopic(d) ? { storeCategory: d.category } : {}),
    }));
  }

  /**
   * Which of a store's categories a topic belongs to — the ONE place
   * that question is answered, read by the dispatcher when it applies the
   * store's own half of the two layers.
   *
   * An unknown topic has no category and is therefore NOT gated by the
   * store's preferences: a message the catalogue does not know about must
   * still arrive. Same reason the preference resolver fails open (NOTIF-15)
   * — silently dropping a notification nobody chose to drop is the worse
   * of the two failures.
   */
  storeCategoryOf(topic: string): StoreNotificationCategory | null {
    return STORE_TOPICS.find((t) => t.topic === topic)?.category ?? null;
  }
}

/** A topic that declares which of the STORE's categories it belongs to. */
function isStoreTopic(def: TopicDef): def is StoreTopicDef {
  return 'category' in def;
}

function defsFor(subjectType: NotificationSubjectType): readonly TopicDef[] {
  switch (subjectType) {
    case NotificationSubjectType.SELLER_USER:
      return SELLER_TOPICS;
    case NotificationSubjectType.STAFF_USER:
      return STAFF_TOPICS;
    case NotificationSubjectType.STORE_USER:
      return STORE_TOPICS;
    default: {
      // F2: a fourth identity has to be given a list before this builds.
      const never: never = subjectType;
      throw new Error(`Unhandled notification subject type: ${String(never)}`);
    }
  }
}

/**
 * What a seller's own people can hear about.
 *
 * One entry per in-app leg in the NOTIF-4 fan-out table, keyed on the
 * template code WITHOUT its `.email` suffix — the same key the listener
 * writes, because a topic somebody silences here has to be the topic
 * the dispatcher looks up.
 */
export const SELLER_TOPICS: readonly TopicDef[] = [
  {
    topic: 'order.confirmed.seller',
    label: 'Order confirmed',
    description: 'An order was confirmed on the phone and is heading to the floor.',
    group: 'Orders',
  },
  {
    topic: 'seller.order_cancelled',
    label: 'Order cancelled',
    description: 'An order was cancelled and any stock held for it released.',
    group: 'Orders',
  },
  {
    topic: 'seller.order_awaiting_decision',
    label: 'An order needs a decision',
    description: 'An order hit the call limit and is waiting on you, with its stock still held.',
    group: 'Orders',
  },
  {
    topic: 'seller.order_dispatched',
    label: 'Order dispatched',
    description: 'A parcel left the warehouse with the courier.',
    group: 'Shipments',
  },
  {
    topic: 'seller.order_delivered',
    label: 'Order delivered',
    description: 'A parcel reached the customer.',
    group: 'Shipments',
  },
  {
    topic: 'seller.order_delivery_failed',
    label: 'Delivery attempt failed',
    description: 'The courier could not deliver and will try again.',
    group: 'Shipments',
  },
  {
    topic: 'shipment.rto_initiated.seller',
    label: 'Order coming back',
    description: 'A parcel is being returned to the warehouse.',
    group: 'Returns',
  },
  {
    topic: 'seller.order_rto_received',
    label: 'Returned goods received',
    description: 'A returned parcel came back and was checked in.',
    group: 'Returns',
  },
  // Not NOTIF-4 legs: standalone senders whose EMAIL leg was retired on
  // 2026-09-20, so the inbox is now the only channel they arrive on
  // (`RETIRED_EMAIL_TEMPLATES`). The spec pins each key to the constant
  // its sender exports.
  {
    topic: 'seller.order_needs_attention',
    label: 'An order needs attention',
    description:
      'An order has stopped moving and somebody should look at it — raised by the nightly sweep, and again if it is still stuck.',
    group: 'Orders',
  },
  {
    topic: 'seller.stock_low_alert',
    label: 'Stock running low',
    description: 'A SKU fell to or below its low-stock threshold at one of the warehouses.',
    group: 'Inventory',
  },
  {
    topic: 'seller.goods_receipt_discrepancy',
    label: 'A count did not match',
    description:
      'What we counted at the warehouse differs from what the receipt expected, or something arrived damaged.',
    group: 'Inventory',
  },
  {
    topic: 'seller.invoice.delivered',
    label: 'An invoice was issued',
    description: 'An order was delivered and its tax invoice is ready on the order’s page.',
    group: 'Wallet',
  },
  {
    topic: 'seller.topup_submitted',
    label: 'Top-up submitted',
    description:
      'Somebody at your company declared a bank transfer. It is credited once we have seen it in the bank.',
    group: 'Wallet',
  },
  {
    // Not a NOTIF-4 leg: sent by UnpayableWithdrawalService. The spec
    // pins this key to that service's exported constant.
    topic: 'wallet.withdrawal_auto_rejected',
    label: 'Withdrawal rejected automatically',
    description:
      'Charges left your wallet below a pending withdrawal, so we rejected it — you can ask again.',
    group: 'Wallet',
  },
  // Not NOTIF-4 legs: sent by TicketNotifier (TKT-3). The spec pins each
  // key to the constant its sender uses.
  {
    topic: 'ticket.opened_for_you',
    label: 'We opened a ticket for you',
    description:
      'We found a problem with your goods — damage on a return, or a short count at the warehouse — and opened a ticket about it.',
    group: 'Tickets',
  },
  {
    topic: 'ticket.reply',
    label: 'A reply on your ticket',
    description: 'Somebody at Skydrop answered on one of your tickets.',
    group: 'Tickets',
  },
  {
    topic: 'ticket.resolved',
    label: 'A ticket was closed',
    description: 'One of your tickets was settled or closed, including any refund to your wallet.',
    group: 'Tickets',
  },
  {
    // Sent by ReceiptShortfallTicketService when a count comes up OVER.
    topic: 'inventory.receipt_surplus',
    label: 'More arrived than you declared',
    description:
      'A goods receipt counted more units than were declared. The extra units carry on with the rest of your goods; nothing to do.',
    group: 'Inventory',
  },
  {
    // Sent by ResellerStoreNotifier (RS-1) when Skydrop opens a reseller
    // store on the seller's account. The spec pins this key to the
    // notifier's exported constant.
    topic: 'seller.reseller_store_pending',
    label: 'A reseller store waits for your approval',
    description:
      'Skydrop opened a reseller store on your account. Nothing about it is live until you approve or reject it.',
    group: 'Reseller stores',
  },
  {
    // Sent by ResellerSetAsideNotifier (RS-3) when the hourly sweep cuts
    // a reseller set-aside because stock fell below what was promised.
    topic: 'seller.reseller_set_aside_shrunk',
    label: 'Stock set aside for a reseller store was reduced',
    description:
      'Stock fell below what you had set aside for your reseller stores, so the newest set-asides were reduced to fit.',
    group: 'Reseller stores',
  },
  {
    // Sent by ResellerTermsNotifier (RS-4) to the people holding
    // `stores.pricing` when a store accepts a version of its terms.
    topic: 'seller.reseller_terms_accepted',
    label: 'A reseller store accepted your terms',
    description:
      'A store accepted the version of the terms you published; its next orders are priced and credited under it.',
    group: 'Reseller stores',
  },
  {
    // Sent by ResellerTermsNotifier (RS-4) when Skydrop switches credit
    // after confirmation off while stores' current terms still use it.
    topic: 'seller.reseller_terms_need_revision',
    label: 'A reseller store needs new terms',
    description:
      'A store’s current terms use a timing Skydrop no longer allows for your account. It cannot order until you publish new terms and it accepts them.',
    group: 'Reseller stores',
  },
  {
    // Sent by ResellerReportsNotifier (RS-9) to `stores.manage` when the
    // store's return rate crossed the limit the seller set, and it paused.
    topic: 'seller.reseller_store_auto_paused',
    label: 'A reseller store was paused for too many returns',
    description:
      'More of a store’s parcels came back than the limit you set, so it was paused: it cannot place new orders until you resume it.',
    group: 'Reseller stores',
  },
  {
    // Sent by ResellerReportsNotifier (RS-9) to `stores.reports`, at most
    // once a week while a product your stores sell stays low.
    topic: 'seller.reseller_stock_reorder',
    label: 'Stock your reseller stores sell is running low',
    description:
      'At the rate it sold recently, stock of a product your reseller stores sell will run out sooner than your reorder threshold.',
    group: 'Reseller stores',
  },
  {
    // Sent by AddressChangeNotifier (2026-09-16) to `stores.manage` when
    // a store corrects a delivery address and the seller's policy for
    // that store says they approve it first.
    topic: 'seller.store_address_change_waiting',
    label: 'A reseller store wants to correct an address',
    description:
      'A store says the delivery details on one of its orders are wrong. The parcel keeps the old address until you answer.',
    group: 'Reseller stores',
  },
  {
    // Sent by StoreActionNotifier (2026-09-16) to `stores.manage` when a
    // store asks for a call, a re-attempt or a send-back and the seller's
    // policy says they approve it first. Sent since 2026-09-16 and missing
    // from this list until 2026-09-17, so it could not be silenced.
    topic: 'seller.store_action_waiting',
    label: 'A reseller store is waiting on you about a delivery',
    description:
      'A store asked for its customer to be called again, another delivery attempt, or the parcel back, and you approve those first.',
    group: 'Reseller stores',
  },
  {
    // Sent by StoreRequestNotifier (2026-09-17) to `stores.manage` when a
    // store asks to cancel, answers the call-cap question, or raises an
    // issue with Skydrop, and the seller's policy says they approve it.
    topic: 'seller.store_request_waiting',
    label: 'A reseller store wants to cancel, answer a call question, or raise an issue',
    description:
      'A store sent you something to approve before it happens: calling an order off, whether to keep calling a customer, or an issue for Skydrop.',
    group: 'Reseller stores',
  },
  {
    // Sent by StoreRequestNotifier (2026-09-17) once, when any request a
    // store sent you is still unanswered after the reminder threshold.
    //
    // UNMUTABLE (owner, 2026-09-18) — see `IMMUTABLE_TOPICS`. It is the
    // only thing standing between "a store is waiting on you" and a
    // request closing itself with nobody having read it.
    topic: 'seller.store_request_reminder',
    label: 'A reseller store is still waiting on your answer',
    description:
      'Something a store asked you to approve has not been answered. If nobody answers in time it closes on its own and the store is told. This one cannot be switched off.',
    group: 'Reseller stores',
  },
  {
    // Sent by StoreRequestNotifier (2026-09-18) when a reseller store
    // changes one of its own orders, or its own customer's record, under
    // a policy the seller set to DIRECT. Whoever did not make the change
    // hears about it.
    topic: 'seller.store_changed_order',
    label: 'A reseller store changed one of its orders',
    description:
      'A store changed an order of its own — the customer’s details, what is in the parcel, or the money — or changed a customer’s record. You own the goods, so you are told what moved.',
    group: 'Reseller stores',
  },
  {
    // Sent by StoreRequestNotifier (2026-09-19) when a Skydrop admin
    // changes a money-affecting field on a reseller order through god
    // mode (ORD-2). Neither you nor the store made that change, so both
    // of you are told.
    topic: 'seller.store_order_money_changed_by_admin',
    label: 'Skydrop changed the money on a reseller order',
    description:
      'A Skydrop admin changed what is collected on one of your reseller stores’ orders. You and the store are both told what moved, and what each of you is now credited.',
    group: 'Reseller stores',
  },
];

/**
 * What staff can hear about: one entry per `SystemIssueKind`.
 *
 * These are things that are WRONG and need a person. Muting one is a
 * real choice with a real cost, which is why each says what it is
 * rather than showing an enum value.
 */
export const STAFF_TOPICS: readonly TopicDef[] = [
  {
    topic: topicForIssue(SystemIssueKind.WAREHOUSE_SCAN),
    label: 'Duplicate parcel scan',
    description:
      'The same box was scanned twice at pack or handover. Either a duplicate label exists or somebody is working from a pile already done.',
    group: 'Warehouse',
  },
  {
    topic: topicForIssue(SystemIssueKind.TRACKING_STALLED),
    label: 'A parcel stopped matching its order',
    description: 'Courier scans are arriving that the order cannot follow, so it has stalled.',
    group: 'Orders',
  },
  {
    topic: topicForIssue(SystemIssueKind.LIVE_WAYBILL),
    label: 'A cancelled order still has a live waybill',
    description:
      'The order was cancelled but its waybill was never cancelled with the courier, so the booking charge has not been credited back.',
    group: 'Couriers',
  },
  {
    topic: topicForIssue(SystemIssueKind.COURIER_DECISION),
    label: 'We picked a courier because nobody did',
    description:
      'A parcel waited for somebody to choose its carrier and was booked with the cheapest option instead.',
    group: 'Couriers',
  },
  {
    topic: topicForIssue(SystemIssueKind.COURIER_PORTAL_LOGIN),
    label: 'Courier portal login failed',
    description: 'We could not sign in to a courier’s portal.',
    group: 'Couriers',
  },
  {
    topic: topicForIssue(SystemIssueKind.COURIER_PORTAL_CHALLENGE),
    label: 'Courier portal asked for a code',
    description: 'A courier portal wants an OTP or a challenge answered by a person.',
    group: 'Couriers',
  },
  {
    topic: topicForIssue(SystemIssueKind.COURIER_CREDENTIAL),
    label: 'Courier credential problem',
    description: 'A stored courier credential stopped working.',
    group: 'Couriers',
  },
  {
    topic: topicForIssue(SystemIssueKind.COURIER_COST_SYNC),
    label: 'Courier cost sync failed',
    description: 'The nightly pull of what a courier actually charged us did not complete.',
    group: 'Couriers',
  },
  {
    topic: topicForIssue(SystemIssueKind.INTEGRATION),
    label: 'Integration problem',
    description: 'An outside system we depend on is not answering as expected.',
    group: 'System',
  },
  {
    topic: topicForIssue(SystemIssueKind.API_ERROR),
    label: 'An endpoint is failing',
    description:
      'A request to our own API threw something nobody anticipated, so whoever made it was told only that something went wrong.',
    group: 'System',
  },
  {
    topic: topicForIssue(SystemIssueKind.MONEY),
    label: 'Money that half-moved',
    description:
      'A payment went out or a charge did not land, and nothing downstream would have noticed on its own.',
    group: 'Money',
  },
  {
    topic: topicForIssue(SystemIssueKind.RESELLER_RISK),
    label: 'A reseller store looks risky',
    description:
      'A reseller store crossed a fraud-signal threshold — cancel, return or failed-delivery rate, one customer across many stores, retail far above suggested, or rapid-fire orders.',
    group: 'Sellers',
  },
  {
    topic: topicForIssue(SystemIssueKind.OTHER),
    label: 'Everything else',
    description: 'A problem that did not fit another kind.',
    group: 'System',
  },
  // Not system issues: a seller speaking on a ticket (TKT-3), sent by
  // TicketNotifier to everyone who can open the tickets queue.
  {
    topic: 'ticket.seller_opened',
    label: 'A seller opened a ticket',
    description: 'A seller raised an issue about one of their parcels or orders.',
    group: 'Tickets',
  },
  {
    topic: 'ticket.seller_replied',
    label: 'A seller replied on a ticket',
    description: 'A seller answered on one of their tickets, and may be waiting on us.',
    group: 'Tickets',
  },
  // Not a system issue: a stranger asked to be let into the beta. Its
  // email leg was retired on 2026-09-20, so for anybody with an account
  // this is the only channel it arrives on.
  {
    topic: 'staff.invite_lead',
    label: 'A new invite request',
    description: 'Somebody asked to be let into the beta from the marketing site.',
    group: 'Sellers',
  },
  // Not a system issue: somebody asked for a serial label to be reprinted
  // (LBL-5b), sent by LabelReprintRequestService to everyone who can
  // approve it.
  {
    topic: 'label_reprint.requested',
    label: 'A label reprint is waiting for approval',
    description:
      'Somebody asked to reprint a damaged or lost serial label. A second person has to approve it before it can be printed.',
    group: 'Warehouse',
  },
];

/**
 * What a RESELLER STORE's own people can hear about (2026-09-19).
 *
 * One entry per message Skydrop already sends a store, keyed on the
 * email template code WITHOUT its `.email` suffix — the NOTIF-14 rule,
 * because the two legs of one notification are silenced by different
 * people and must not share a key.
 *
 * ── EVERY ONE OF THESE WAS ALREADY BEING SENT ────────────────────────
 * The store has been emailed about all of it since RS-4/RS-5 and the
 * 2026-09-16..18 store-action work. What was missing was an inbox to
 * put it in, a way to choose, and — for disputes — anything at all.
 *
 * ── WHY SOME ARE LOCKED ──────────────────────────────────────────────
 * The owner named three kinds that can never be switched off: the answer
 * to something the store asked, anything about its money, and a change
 * to one of its orders. Each locked topic here is one of those, and its
 * reason lives in `IMMUTABLE_TOPICS` so the refusal and the screen say
 * the same words (`mutable: false` is derived from that map, never
 * restated here).
 *
 * `store-notification-catalog.spec.ts` pins BOTH directions: every topic
 * the store is sent is listed, every listed topic is sent, and every
 * topic filed under MONEY is immutable — which binds the first money
 * topic somebody adds, rather than leaving it to be remembered.
 */
export const STORE_TOPICS: readonly StoreTopicDef[] = [
  // ── The answers to what the store asked ────────────────────────────
  {
    topic: 'store.request_approved',
    label: 'The seller agreed',
    description:
      'Something you sent the seller to approve — calling an order off, whether to keep ringing a customer, or an issue for Skydrop — was agreed, and what happened next.',
    group: 'Your requests',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.request_rejected',
    label: 'The seller said no',
    description: 'Something you sent the seller to approve was turned down, with their reason.',
    group: 'Your requests',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.request_expired',
    label: 'Nobody answered in time',
    description:
      'A request you sent the seller went unanswered long enough that it closed itself. The order kept what it already had.',
    group: 'Your requests',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.action_approved',
    label: 'Your delivery request was agreed',
    description:
      'The seller agreed to have a customer called again, another delivery attempt made, or a parcel sent back.',
    group: 'Your requests',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.action_rejected',
    label: 'Your delivery request was turned down',
    description:
      'The seller said no to a call, a re-attempt or a return you asked for, with their reason.',
    group: 'Your requests',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.address_change_approved',
    label: 'Your address correction was agreed',
    description:
      'The seller agreed to correct a delivery address — and whether it actually went onto the order, because a courier can still refuse one after the seller has said yes.',
    group: 'Your requests',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.address_change_rejected',
    label: 'Your address correction was turned down',
    description:
      'The seller said no to a delivery-address correction. The parcel keeps the details it already had.',
    group: 'Your requests',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  // ── Somebody else changed your things ──────────────────────────────
  {
    topic: 'store.order_changed_by_seller',
    label: 'The seller changed one of your orders',
    description:
      'What is in the parcel, what the customer pays, or who it goes to — with the old value beside the new one, and the money’s before and after when it moved.',
    group: 'Your orders',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.order_changed_by_admin',
    label: 'Skydrop changed one of your orders',
    description:
      'Skydrop changed an order directly — what the customer pays, or how they pay — with the money\u2019s before and after. Neither you nor the seller made this change.',
    group: 'Your orders',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  {
    topic: 'store.customer_changed_by_seller',
    label: 'The seller changed a customer’s details',
    description:
      'The seller corrected what we hold about one of your customers — their name, email, second phone or language. Their phone number never changes.',
    group: 'Your orders',
    category: StoreNotificationCategory.ORDER_UPDATES,
  },
  // ── Disputes and issues ────────────────────────────────────────────
  {
    topic: 'store.ticket_reply',
    label: 'A reply on your ticket',
    description:
      'Skydrop or the seller answered on a dispute or an issue you raised, and may be waiting on you.',
    group: 'Tickets',
    category: StoreNotificationCategory.SUPPORT,
  },
  {
    topic: 'store.ticket_resolved',
    label: 'A ticket was settled or closed',
    description:
      'One of your disputes or issues was settled or closed — including any money moved between your wallet and the seller’s.',
    group: 'Tickets',
    category: StoreNotificationCategory.SUPPORT,
  },
  // ── The seller's terms ─────────────────────────────────────────────
  {
    topic: 'store.terms_published',
    label: 'New terms to accept',
    description:
      'The seller published a new version of your terms — who pays which Skydrop fee, and when each side is credited. You cannot place new orders until somebody accepts it.',
    group: 'Terms',
    category: StoreNotificationCategory.TERMS,
  },
];

/** The one place an issue kind becomes a topic key. */
export function topicForIssue(kind: SystemIssueKind): string {
  return `system_issue.${kind.toLowerCase()}`;
}
