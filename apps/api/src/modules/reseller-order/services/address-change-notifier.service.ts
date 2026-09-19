import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { StoreNotificationSender } from '../../notification-audience/services/store-notification-sender.service';

/** The store-user emails (NOTIF-14: the code without `.email`). */
export const STORE_ADDRESS_CHANGE_APPROVED_TEMPLATE = 'store.address_change_approved.email';
export const STORE_ADDRESS_CHANGE_REJECTED_TEMPLATE = 'store.address_change_rejected.email';
/** The STORE-side in-app topics the same two messages carry (2026-09-19). */
export const STORE_ADDRESS_CHANGE_APPROVED_TOPIC = 'store.address_change_approved';
export const STORE_ADDRESS_CHANGE_REJECTED_TOPIC = 'store.address_change_rejected';
/** Who at the seller is told a correction is waiting: whoever runs their stores. */
export const STORES_MANAGE_PERMISSION = 'stores.manage';
/**
 * The topic a seller can silence this under.
 *
 * Exported because `notification-topic-catalog.service.spec.ts` pins the
 * catalogue against each sender's OWN constant, in both directions — a
 * topic on the settings page the dispatcher never looks up reads to a
 * person as a switch they flicked that did nothing (NOTIF-17).
 */
export const STORE_ADDRESS_CHANGE_WAITING_TOPIC = 'seller.store_address_change_waiting';

/**
 * Telling each side about a held address correction (2026-09-16).
 *
 * ── WHY THIS IS NOT `StoreActionNotifier` ────────────────────────────
 * That one lives in `delivery-action`, whose module header states it is
 * a LEAF that nothing imports. Reaching for it from `reseller-order`
 * would close no cycle, but it would spend that property — and the
 * property is what keeps the courier-facing module from slowly becoming
 * everybody's dependency. So this is a second notifier of the same
 * SHAPE, deliberately, rather than a new module edge.
 *
 * ── THE STORE HEARS ON BOTH CHANNELS (amended 2026-09-19) ────────────
 * This said "by email, and only by email", because a reseller store had
 * no inbox. It has one now, so the same message goes to both through
 * `StoreNotificationSender`, the email unchanged. Neither leg can be
 * silenced: "your correction was agreed — and the courier then refused
 * it" is exactly the message a store cannot afford to miss, and it is on
 * `IMMUTABLE_TOPICS` for that reason.
 *
 * ── THE SELLER HEARS IN-APP ──────────────────────────────────────────
 * Addressed by PERMISSION (NOTIF-10), so it reaches whoever runs the
 * stores rather than a named person who may have left.
 *
 * NEVER THROWS (NOTIF-1). The request and its decision are the durable
 * facts; this is a reflection of them. Awaited by callers rather than
 * fire-and-forget, so the e2e reset has no in-flight write to drain
 * (NOTIF-19).
 */
@Injectable()
export class AddressChangeNotifier {
  private readonly logger = new Logger(AddressChangeNotifier.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly store: StoreNotificationSender,
  ) {}

  /** A store corrected an address and the seller's policy said "ask me". */
  async waitingOnSeller(input: {
    sellerId: string;
    requestId: string;
    storeName: string;
    orderNumber: string;
    reason: string;
    summary: string;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: STORE_ADDRESS_CHANGE_WAITING_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `“${input.storeName}” wants to correct an address on ${input.orderNumber}`,
        body:
          `${input.storeName} says the delivery details on order ${input.orderNumber} are wrong ` +
          `and wants to change ${input.summary}. They said: “${input.reason}”. ` +
          `The parcel still carries the OLD address until you answer.`,
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.address_change_requested',
        eventId: `store_address_change_waiting:${input.requestId}:inapp`,
      });
    } catch (err) {
      this.warn('Could not tell the seller an address correction is waiting', input.requestId, err);
    }
  }

  /**
   * The seller answered.
   *
   * `applied` is a THIRD outcome, not a flavour of approved: seller staff
   * can say yes to a correction the order has already moved past, and
   * "they agreed but it did not happen" is what the store has to tell
   * their customer. It carries the failure reason for that case.
   */
  async decided(input: {
    storeId: string;
    requestId: string;
    approved: boolean;
    applied: boolean;
    failureReason: string | null;
    orderId: string;
    orderNumber: string;
    sellerName: string;
    reason: string;
    summary: string;
    decisionNote: string | null;
  }): Promise<void> {
    const note = input.decisionNote === null ? '' : ` They said: “${input.decisionNote}”.`;
    // The case that matters most: agreed, and then it did not happen.
    // The inbox line has to carry it, or the store reads "agreed" and
    // tells a customer an address moved that did not.
    const failed =
      input.approved && !input.applied
        ? ` It could not be written onto the order: ${input.failureReason ?? 'the order had moved on'}.`
        : '';

    await this.store.tell({
      storeId: input.storeId,
      topic: input.approved
        ? STORE_ADDRESS_CHANGE_APPROVED_TOPIC
        : STORE_ADDRESS_CHANGE_REJECTED_TOPIC,
      templateCode: input.approved
        ? STORE_ADDRESS_CHANGE_APPROVED_TEMPLATE
        : STORE_ADDRESS_CHANGE_REJECTED_TEMPLATE,
      // Per decision, not per request: a rejection and a later approval
      // of the same correction are two things to say. UNCHANGED from
      // what the email was already keyed on.
      eventId: `store_address_change_decided:${input.requestId}:${
        input.approved ? (input.applied ? 'yes' : 'yes-failed') : 'no'
      }`,
      title: input.approved
        ? input.applied
          ? `Address corrected — ${input.orderNumber}`
          : `Agreed, but not applied — ${input.orderNumber}`
        : `Address correction turned down — ${input.orderNumber}`,
      body: input.approved
        ? `${input.sellerName} agreed to your correction on order ${input.orderNumber}: ` +
          `${input.summary}.${note}${failed}`
        : `${input.sellerName} said no to your correction on order ${input.orderNumber}: ` +
          `${input.summary}. The parcel keeps the details it already had.${note}`,
      variables: {
        seller_name: input.sellerName,
        order_number: input.orderNumber,
        change_summary: input.summary,
        reason: input.reason,
        decision_note: input.decisionNote ?? '',
        // Empty on the ordinary approval, so the template's line renders
        // as nothing rather than as a missing variable.
        failure_reason: input.applied ? '' : (input.failureReason ?? ''),
      },
      orderId: input.orderId,
      triggerEvent: 'reseller_store.address_change_decided',
      // The audience this email has always had: the people who asked.
      permissions: ['orders.actions'],
      ref: input.requestId,
    });
  }

  private warn(what: string, requestId: string, err: unknown): void {
    this.logger.warn({ requestId, err: err instanceof Error ? err.message : err }, what);
  }
}
