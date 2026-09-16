import { Injectable, Logger } from '@nestjs/common';
import {
  DeliveryActionKind,
  NotificationCategory,
  NotificationChannel,
  NotificationRecipientType,
} from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';

/** The store-user emails (NOTIF-14: the code without `.email`). */
export const STORE_ACTION_APPROVED_TEMPLATE = 'store.action_approved.email';
export const STORE_ACTION_REJECTED_TEMPLATE = 'store.action_rejected.email';
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
 * ── THE STORE HEARS BY EMAIL, AND ONLY BY EMAIL ──────────────────────
 * A reseller store has no in-app inbox. An in-app leg here would be
 * written to a feed nobody at the store can open — the "a setting that
 * changes nothing" failure NOTIF-15 is about, in notification form. So
 * the store's half is email to the people who may act on orders, and the
 * portal shows the request's own status besides.
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
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
    private readonly ledger: NotificationLedgerService,
    private readonly env: EnvService,
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

  /** The seller answered. The store reads this and goes back to their customer. */
  async decided(input: {
    storeId: string;
    requestId: string;
    approved: boolean;
    orderId: string;
    orderNumber: string;
    sellerName: string;
    action: DeliveryActionKind;
    reason: string;
    decisionNote: string | null;
  }): Promise<void> {
    try {
      const people = await this.prisma.client.storeUser.findMany({
        where: {
          storeId: input.storeId,
          deletedAt: null,
          role: {
            deletedAt: null,
            OR: [{ isOwner: true }, { permissions: { some: { permission: 'orders.actions' } } }],
          },
        },
        select: { id: true, emailDisplay: true, fullName: true },
      });
      for (const person of people) {
        try {
          await this.ledger.enqueue({
            // Per decision, not per request: a rejection and a later
            // approval of the same ask are two things to say.
            eventId: `store_action_decided:${input.requestId}:${input.approved ? 'yes' : 'no'}`,
            recipientType: NotificationRecipientType.STORE_USER,
            recipientId: person.id,
            channel: NotificationChannel.EMAIL,
            templateCode: input.approved
              ? STORE_ACTION_APPROVED_TEMPLATE
              : STORE_ACTION_REJECTED_TEMPLATE,
            locale: 'en',
            toEmail: person.emailDisplay,
            variables: {
              full_name: person.fullName,
              seller_name: input.sellerName,
              order_number: input.orderNumber,
              action_label: ACTION_LABEL[input.action],
              reason: input.reason,
              decision_note: input.decisionNote ?? '',
              order_url: `${this.env.resellerAppUrl}/orders/${input.orderId}`,
              app_url: this.env.resellerAppUrl,
            },
            orderId: input.orderId,
            shipmentId: null,
            triggerEvent: 'reseller_store.action_decided',
          });
        } catch (err) {
          this.warn('Decision email to a store user could not be queued', input.requestId, err);
        }
      }
    } catch (err) {
      this.warn('Could not tell the store what was decided', input.requestId, err);
    }
  }

  private warn(what: string, requestId: string, err: unknown): void {
    this.logger.warn({ requestId, err: err instanceof Error ? err.message : err }, what);
  }
}
