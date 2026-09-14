import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, NotificationRecipientType } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';

/** The in-app topic (NOTIF-14: the email template code without `.email`). */
export const RESELLER_STORE_PENDING_TOPIC = 'seller.reseller_store_pending';
export const RESELLER_STORE_PENDING_TEMPLATE = 'seller.reseller_store_pending.email';
/** Who at the seller is told: the people who can approve it. */
export const STORES_MANAGE_PERMISSION = 'stores.manage';

/**
 * RS-1 — tells a seller that Skydrop opened a reseller store for them and
 * it waits on their approval.
 *
 * In-app to the people at that seller who hold `stores.manage`, and an
 * email to the company address through the ledger (NOTIF-2
 * store-then-send). OPERATIONAL, never CREDENTIAL (NOTIF-9) — so each
 * PERSON may silence the in-app topic on their own settings (NOTIF-17).
 *
 * The EMAIL is deliberately not gated by the company's category
 * preferences (NOTIF-15). None of the seven categories covers "a decision
 * only you can make": filed under any of them, switching that category
 * off would leave a store waiting forever with nobody at the seller told.
 *
 * AWAITED after the store's transaction commits, and NEVER throws: the
 * store is the durable fact, the notice a reflection of it (NOTIF-1).
 * Awaited rather than fire-and-forget so it has finished before the
 * request returns — there is then no in-flight write for the e2e reset
 * to drain (NOTIF-19). Each leg carries an event id derived from the
 * store, so a retry is refused by the NOTIF-2 partial unique.
 */
@Injectable()
export class ResellerStoreNotifier {
  private readonly logger = new Logger(ResellerStoreNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
    private readonly ledger: NotificationLedgerService,
    private readonly env: EnvService,
  ) {}

  async pendingApproval(input: {
    storeId: string;
    sellerId: string;
    storeName: string;
  }): Promise<void> {
    const url = `${this.env.sellerAppUrl}/reseller-stores/${input.storeId}`;
    const title = `Skydrop opened “${input.storeName}” for you — approve or reject it`;
    const body =
      `We created a reseller store called “${input.storeName}” on your account. ` +
      'Nothing can be ordered through it until you approve it. You can also reject it.';

    try {
      await this.dispatch.dispatch({
        topic: RESELLER_STORE_PENDING_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title,
        body,
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_MANAGE_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.created',
        eventId: `reseller_store_pending:${input.storeId}:inapp`,
      });
    } catch (err) {
      this.logger.warn(
        { storeId: input.storeId, err: err instanceof Error ? err.message : String(err) },
        'Reseller store in-app notice failed; the email leg is unaffected',
      );
    }

    try {
      const seller = await this.prisma.client.seller.findUnique({
        where: { id: input.sellerId },
        select: { email: true, companyName: true },
      });
      if (seller === null) return;
      await this.ledger.enqueue({
        eventId: `reseller_store_pending:${input.storeId}`,
        recipientType: NotificationRecipientType.SELLER,
        recipientId: input.sellerId,
        channel: NotificationChannel.EMAIL,
        templateCode: RESELLER_STORE_PENDING_TEMPLATE,
        locale: 'en',
        toEmail: seller.email,
        variables: {
          company_name: seller.companyName,
          store_name: input.storeName,
          store_url: url,
          app_url: this.env.sellerAppUrl,
        },
        orderId: null,
        shipmentId: null,
        triggerEvent: 'reseller_store.created',
      });
    } catch (err) {
      this.logger.warn(
        { storeId: input.storeId, err: err instanceof Error ? err.message : String(err) },
        'Reseller store approval email could not be queued',
      );
    }
  }
}
