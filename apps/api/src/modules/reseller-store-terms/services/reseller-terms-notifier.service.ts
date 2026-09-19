import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { StoreNotificationSender } from '../../notification-audience/services/store-notification-sender.service';

/** In-app topics (NOTIF-14 / NOTIF-17), pinned by notification-topic-catalog.service.spec.ts. */
export const RESELLER_TERMS_ACCEPTED_TOPIC = 'seller.reseller_terms_accepted';
export const RESELLER_TERMS_NEED_REVISION_TOPIC = 'seller.reseller_terms_need_revision';
/** The store-user email (OPERATIONAL — no credential word in the code). */
export const STORE_TERMS_PUBLISHED_TEMPLATE = 'store.terms_published.email';
/** The STORE-side in-app topic the same message carries (2026-09-19). */
export const STORE_TERMS_PUBLISHED_TOPIC = 'store.terms_published';
/** Who at the seller hears about terms: the people who publish them. */
export const STORES_PRICING_PERMISSION = 'stores.pricing';
/** Who at the store is emailed a new version: the people who may accept it. */
export const TERMS_ACCEPT_PERMISSION = 'terms.accept';

/**
 * RS-4 — the three notices terms produce.
 *
 *  1. A seller published a version → an EMAIL to every store user who may
 *     accept it (owner, or a role holding `terms.accept`), and since
 *     2026-09-19 an inbox line beside it. The BANNER survives and is not
 *     replaced: it is a BLOCKING CONDITION rather than an event — the
 *     store cannot place orders until the version is accepted — and the
 *     whole value of a banner is that it cannot be dismissed, only
 *     answered. An inbox line is the opposite kind of thing: it says
 *     "this happened", and it is dismissible on purpose. Both, for the
 *     same fact, each doing what the other cannot.
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
    private readonly dispatch: NotificationDispatchService,
    private readonly store: StoreNotificationSender,
    private readonly env: EnvService,
  ) {}

  async published(input: {
    storeId: string;
    termsVersionId: string;
    version: number;
    storeName: string;
    sellerName: string;
  }): Promise<void> {
    await this.store.tell({
      storeId: input.storeId,
      topic: STORE_TERMS_PUBLISHED_TOPIC,
      templateCode: STORE_TERMS_PUBLISHED_TEMPLATE,
      // UNCHANGED from what the email was already keyed on.
      eventId: `reseller_terms_published:${input.termsVersionId}`,
      title: `New terms to accept — version ${input.version}`,
      body:
        `${input.sellerName} published version ${input.version} of your terms — who pays ` +
        'which Skydrop fee on your orders, and when each side is credited. ' +
        `${input.storeName} cannot place new orders until somebody accepts it.`,
      variables: {
        store_name: input.storeName,
        seller_name: input.sellerName,
        version: String(input.version),
        terms_url: `${this.env.resellerAppUrl}/terms`,
      },
      orderId: null,
      triggerEvent: 'reseller_store.terms_published',
      // The people who may ACCEPT it, which is who this email has always
      // gone to — not the order permissions the sender defaults to.
      permissions: [TERMS_ACCEPT_PERMISSION],
      ref: input.storeId,
    });
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
