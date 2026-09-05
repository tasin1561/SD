import { Injectable } from '@nestjs/common';
import { NotificationSubjectType, SystemIssueKind } from '@skydrop/db';

export interface TopicDef {
  /** The stable key a subscription row is written against. */
  readonly topic: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
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
  forSubject(subjectType: NotificationSubjectType): readonly TopicDef[] {
    return subjectType === NotificationSubjectType.SELLER_USER ? SELLER_TOPICS : STAFF_TOPICS;
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
    topic: topicForIssue(SystemIssueKind.OTHER),
    label: 'Everything else',
    description: 'A problem that did not fit another kind.',
    group: 'System',
  },
];

/** The one place an issue kind becomes a topic key. */
export function topicForIssue(kind: SystemIssueKind): string {
  return `system_issue.${kind.toLowerCase()}`;
}
