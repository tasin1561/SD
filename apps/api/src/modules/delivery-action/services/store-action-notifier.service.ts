import { Injectable, Logger } from '@nestjs/common';
import { DeliveryActionKind, NotificationCategory, NotificationChannel } from '@skydrop/db';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { StoreNotificationSender } from '../../notification-audience/services/store-notification-sender.service';

/** The store-user emails (NOTIF-14: the code without `.email`). */
export const STORE_ACTION_APPROVED_TEMPLATE = 'store.action_approved.email';
export const STORE_ACTION_REJECTED_TEMPLATE = 'store.action_rejected.email';
/** The STORE-side in-app topics the same two messages carry (2026-09-19). */
export const STORE_ACTION_APPROVED_TOPIC = 'store.action_approved';
export const STORE_ACTION_REJECTED_TOPIC = 'store.action_rejected';
/** Who at the seller is told a store is waiting: whoever runs their stores. */
export const STORES_MANAGE_PERMISSION = 'stores.manage';
export const STORE_ACTION_WAITING_TOPIC = 'seller.store_action_waiting';

/** What the store asked for, in the words the email uses. */
const ACTION_LABEL: Readonly<Record<DeliveryActionKind, string>> = {
  [DeliveryActionKind.RECALL]: 'call the customer again',
  [DeliveryActionKind.REATTEMPT]: 'try delivering it again',
  [DeliveryActionKind.RTO]: 'send the parcel back',
};

/**
 * Telling each side what happened to a store's request (2026-09-16).
 *
 * ── THE STORE HEARS ON BOTH CHANNELS (amended 2026-09-19) ────────────
 * This said "by email, and only by email", because a reseller store had
 * no inbox and a row written to a feed nobody can open is the "setting
 * that changes nothing" failure in notification form. The store HAS an
 * inbox now, so the same message goes to both — one call through
 * `StoreNotificationSender`, the email byte-identical to what it was.
 * Both are silenced separately and neither at all: a decision on
 * something the store asked for is one of the owner's three unsilenceable
 * kinds (`IMMUTABLE_TOPICS`).
 *
 * ── THE SELLER HEARS IN-APP ──────────────────────────────────────────
 * They have an inbox, and what they need is a nudge that somebody is
 * waiting on them — addressed by PERMISSION (NOTIF-10), so it reaches
 * whoever runs the stores rather than a named person who may have left.
 *
 * NEVER THROWS (NOTIF-1). The request and its decision are the durable
 * facts; these are a reflection of them. Awaited by callers rather than
 * fire-and-forget, so the e2e reset has no in-flight write to drain
 * (NOTIF-19) — the ResellerStoreNotifier shape.
 */
@Injectable()
export class StoreActionNotifier {
  private readonly logger = new Logger(StoreActionNotifier.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly store: StoreNotificationSender,
  ) {}

  /** A store asked for something the seller must answer. */
  async waitingOnSeller(input: {
    sellerId: string;
    requestId: string;
    storeName: string;
    orderNumber: string;
    action: DeliveryActionKind;
    reason: string;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: STORE_ACTION_WAITING_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `“${input.storeName}” is waiting on you — ${ACTION_LABEL[input.action]}`,
        body:
          `${input.storeName} asked you to ${ACTION_LABEL[input.action]} on order ` +
          `${input.orderNumber}. They said: “${input.reason}”. Nothing happens until you answer.`,
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.action_requested',
        eventId: `store_action_waiting:${input.requestId}:inapp`,
      });
    } catch (err) {
      this.warn('Could not tell the seller a store is waiting', input.requestId, err);
    }
  }

  /**
   * The seller answered — sent AFTER an approval has run, never before
   * (2026-09-17), so `outcome` says what actually happened: done, or why
   * it could not be. The store reads this and goes back to their customer.
   */
  async decided(input: {
    storeId: string;
    requestId: string;
    approved: boolean;
    /** False when it was approved and could not be carried out. */
    carriedOut: boolean;
    /** What happened, in a sentence. Empty on a rejection. */
    outcome: string;
    orderId: string;
    orderNumber: string;
    sellerName: string;
    action: DeliveryActionKind;
    reason: string;
    decisionNote: string | null;
  }): Promise<void> {
    const label = ACTION_LABEL[input.action];
    const note = input.decisionNote === null ? '' : ` They said: “${input.decisionNote}”.`;

    await this.store.tell({
      storeId: input.storeId,
      topic: input.approved ? STORE_ACTION_APPROVED_TOPIC : STORE_ACTION_REJECTED_TOPIC,
      templateCode: input.approved
        ? STORE_ACTION_APPROVED_TEMPLATE
        : STORE_ACTION_REJECTED_TEMPLATE,
      // Per decision, not per request: a rejection and a later approval
      // of the same ask are two things to say. UNCHANGED from what the
      // email was already keyed on.
      eventId: `store_action_decided:${input.requestId}:${
        input.approved ? (input.carriedOut ? 'yes' : 'yes-failed') : 'no'
      }`,
      title: input.approved
        ? `${input.sellerName} agreed — ${input.orderNumber}`
        : `${input.sellerName} said no — ${input.orderNumber}`,
      body: input.approved
        ? `You asked to ${label} on order ${input.orderNumber}. ${input.sellerName} agreed.` +
          `${note}${input.outcome === '' ? '' : ` ${input.outcome}`}`
        : `You asked to ${label} on order ${input.orderNumber}. ${input.sellerName} said no.${note}`,
      variables: {
        seller_name: input.sellerName,
        order_number: input.orderNumber,
        action_label: label,
        reason: input.reason,
        decision_note: input.decisionNote ?? '',
        outcome: input.outcome,
      },
      orderId: input.orderId,
      triggerEvent: 'reseller_store.action_decided',
      // The audience this email has always had: the people who asked.
      permissions: ['orders.actions'],
      ref: input.requestId,
    });
  }

  private warn(what: string, requestId: string, err: unknown): void {
    this.logger.warn({ requestId, err: err instanceof Error ? err.message : err }, what);
  }
}
