import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, NotificationRecipientType } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';

/** The store-user emails (NOTIF-14: the code without `.email`). */
export const STORE_ADDRESS_CHANGE_APPROVED_TEMPLATE = 'store.address_change_approved.email';
export const STORE_ADDRESS_CHANGE_REJECTED_TEMPLATE = 'store.address_change_rejected.email';
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
 * ── THE STORE HEARS BY EMAIL, AND ONLY BY EMAIL ──────────────────────
 * A reseller store has no in-app inbox, so an in-app leg would be
 * written to a feed nobody there can open — NOTIF-15's "a setting that
 * changes nothing", in notification form.
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
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
    private readonly ledger: NotificationLedgerService,
    private readonly env: EnvService,
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
            // approval of the same correction are two things to say.
            eventId: `store_address_change_decided:${input.requestId}:${
              input.approved ? (input.applied ? 'yes' : 'yes-failed') : 'no'
            }`,
            recipientType: NotificationRecipientType.STORE_USER,
            recipientId: person.id,
            channel: NotificationChannel.EMAIL,
            templateCode: input.approved
              ? STORE_ADDRESS_CHANGE_APPROVED_TEMPLATE
              : STORE_ADDRESS_CHANGE_REJECTED_TEMPLATE,
            locale: 'en',
            toEmail: person.emailDisplay,
            variables: {
              full_name: person.fullName,
              seller_name: input.sellerName,
              order_number: input.orderNumber,
              change_summary: input.summary,
              reason: input.reason,
              decision_note: input.decisionNote ?? '',
              // Empty on the ordinary approval, so the template's line
              // renders as nothing rather than as a missing variable.
              failure_reason: input.applied ? '' : (input.failureReason ?? ''),
              order_url: `${this.env.resellerAppUrl}/orders/${input.orderId}`,
              app_url: this.env.resellerAppUrl,
            },
            orderId: input.orderId,
            shipmentId: null,
            triggerEvent: 'reseller_store.address_change_decided',
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
