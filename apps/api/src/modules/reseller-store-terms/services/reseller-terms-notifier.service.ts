import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, NotificationRecipientType } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { NotificationLedgerService } from '../../notifications/services/notification-ledger.service';

/** In-app topics (NOTIF-14 / NOTIF-17), pinned by notification-topic-catalog.service.spec.ts. */
export const RESELLER_TERMS_ACCEPTED_TOPIC = 'seller.reseller_terms_accepted';
export const RESELLER_TERMS_NEED_REVISION_TOPIC = 'seller.reseller_terms_need_revision';
/** The store-user email (OPERATIONAL — no credential word in the code). */
export const STORE_TERMS_PUBLISHED_TEMPLATE = 'store.terms_published.email';
/** Who at the seller hears about terms: the people who publish them. */
export const STORES_PRICING_PERMISSION = 'stores.pricing';
/** Who at the store is emailed a new version: the people who may accept it. */
export const TERMS_ACCEPT_PERMISSION = 'terms.accept';

/**
 * RS-4 — the three notices terms produce.
 *
 *  1. A seller published a version → an EMAIL to every store user who may
 *     accept it (owner, or a role holding `terms.accept`). Store users have
 *     no inbox in phase 1; the portal's in-app surface for this is the
 *     banner every page shows while the current version is unaccepted —
 *     stronger than a dismissible notice, because it cannot be dismissed,
 *     only answered.
 *  2. A store accepted → in-app to the seller's people holding
 *     `stores.pricing`.
 *  3. Skydrop switched credit-after-confirmation off while stores' current
 *     terms use it → in-app to the same people, naming the stores.
 *
 * AWAITED after the write commits and NEVER throws (NOTIF-1): the terms are
 * the durable fact, the notice a reflection of it. Awaited rather than
 * fire-and-forget so there is no in-flight write left for the e2e reset to
 * drain (NOTIF-19) — the ResellerStoreNotifier shape. Every leg carries an
 * event id derived from the row it is about, so a retry is refused by the
 * NOTIF-2 partial unique.
 */
@Injectable()
export class ResellerTermsNotifier {
  private readonly logger = new Logger(ResellerTermsNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
    private readonly ledger: NotificationLedgerService,
    private readonly env: EnvService,
  ) {}

  async published(input: {
    storeId: string;
    termsVersionId: string;
    version: number;
    storeName: string;
    sellerName: string;
  }): Promise<void> {
    try {
      const people = await this.prisma.client.storeUser.findMany({
        where: {
          storeId: input.storeId,
          deletedAt: null,
          role: {
            deletedAt: null,
            OR: [
              { isOwner: true },
              { permissions: { some: { permission: TERMS_ACCEPT_PERMISSION } } },
            ],
          },
        },
        select: { id: true, emailDisplay: true, fullName: true },
      });
      for (const person of people) {
        try {
          await this.ledger.enqueue({
            eventId: `reseller_terms_published:${input.termsVersionId}`,
            recipientType: NotificationRecipientType.STORE_USER,
            recipientId: person.id,
            channel: NotificationChannel.EMAIL,
            templateCode: STORE_TERMS_PUBLISHED_TEMPLATE,
            locale: 'en',
            toEmail: person.emailDisplay,
            variables: {
              full_name: person.fullName,
              store_name: input.storeName,
              seller_name: input.sellerName,
              version: String(input.version),
              terms_url: `${this.env.resellerAppUrl}/terms`,
              app_url: this.env.resellerAppUrl,
            },
            orderId: null,
            shipmentId: null,
            triggerEvent: 'reseller_store.terms_published',
          });
        } catch (err) {
          this.warn('Terms email to a store user could not be queued', input.storeId, err);
        }
      }
    } catch (err) {
      this.warn('Terms-published notice failed', input.storeId, err);
    }
  }

  async accepted(input: {
    sellerId: string;
    storeId: string;
    storeName: string;
    version: number;
    acceptanceId: string;
    acceptedByName: string;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: RESELLER_TERMS_ACCEPTED_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `“${input.storeName}” accepted version ${input.version} of your terms`,
        body:
          `${input.acceptedByName} accepted version ${input.version} for ${input.storeName}. ` +
          'Orders the store places from now on are priced and credited under it.',
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_PRICING_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_store.terms_accepted',
        eventId: `reseller_terms_accepted:${input.acceptanceId}:inapp`,
      });
    } catch (err) {
      this.warn('Terms-accepted notice failed', input.storeId, err);
    }
  }

  async needsRevision(input: {
    sellerId: string;
    stores: ReadonlyArray<{ storeId: string; storeName: string; version: number }>;
  }): Promise<void> {
    if (input.stores.length === 0) return;
    const names = input.stores.map((s) => `${s.storeName} (version ${s.version})`).join(', ');
    try {
      await this.dispatch.dispatch({
        topic: RESELLER_TERMS_NEED_REVISION_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: 'Some reseller stores need new terms',
        body:
          'Skydrop has switched off credit after confirmation for your account. These stores’ ' +
          `current terms still use it, so they cannot place new orders until you publish new terms and they accept them: ${names}.`,
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: input.sellerId,
            permission: STORES_PRICING_PERMISSION,
          },
        ],
        triggerEvent: 'reseller.credit_after_confirmation.disabled',
        // One notice per switch-off; the store list and versions name the event.
        eventId: `reseller_terms_need_revision:${input.sellerId}:${input.stores
          .map((s) => `${s.storeId}@${s.version}`)
          .join(',')}:${Date.now()}:inapp`,
      });
    } catch (err) {
      this.warn('Terms-need-revision notice failed', input.sellerId, err);
    }
  }

  private warn(message: string, ref: string, err: unknown): void {
    this.logger.warn({ ref, err: err instanceof Error ? err.message : String(err) }, message);
  }
}
