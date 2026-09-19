import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import type { EmailVariables } from '../../email/email.types';
import type { AudienceSelector } from './notification-audience.service';
import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * Store permissions whose holders act on ORDERS, and are therefore the
 * people a decision about one of the store's orders is written to.
 *
 * Lifted verbatim from `StoreRequestNotifier`, where it already was, so
 * the audience the emails have been going to since 2026-09-17 does not
 * change the day they gain an inbox line.
 */
export const STORE_ORDER_PERMISSIONS = [
  'orders.actions',
  'orders.cancel',
  'tickets.manage',
] as const;

export interface TellStoreInput {
  readonly storeId: string;
  /**
   * The in-app TOPIC — the email template code WITHOUT `.email`
   * (NOTIF-14). What a person silences, and what they see named on the
   * settings page.
   */
  readonly topic: string;
  /** The seeded email template. Unchanged from what each notifier sent. */
  readonly templateCode: string;
  /**
   * The per-event dedup key (NOTIF-2). The EMAIL leg uses it as given —
   * so an existing key keeps deduping exactly as it did — and the in-app
   * leg appends `:inapp`, because the two legs must not be able to
   * collide with each other on a later change to either.
   */
  readonly eventId: string;
  /** What the inbox line says. */
  readonly title: string;
  readonly body: string;
  /** What the EMAIL template renders. `full_name` is added per person. */
  readonly variables: EmailVariables;
  readonly orderId: string | null;
  readonly triggerEvent: string;
  /**
   * Who at the store hears it. Defaults to the people who act on orders,
   * which is who every store email has gone to so far; a message about
   * the terms or the wallet should name its own.
   */
  readonly permissions?: readonly string[];
  /** For the log line when something goes wrong. */
  readonly ref: string;
}

/**
 * ONE message to a reseller store, on BOTH channels (2026-09-19, owner
 * decision (a)).
 *
 * ── WHY A SHARED SENDER AND NOT A METHOD ON EACH NOTIFIER ────────────
 * Three notifiers (`StoreRequestNotifier`, `StoreActionNotifier`,
 * `AddressChangeNotifier`) each had their own private `emailStore`, and
 * all three were the same twenty lines: find the store's people, loop,
 * enqueue, swallow. Adding an inbox leg to each copy would have made
 * four places that decide who hears about a store's business and three
 * chances for them to drift on the day somebody changes the audience.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────
 * It does not decide WHETHER to send — that is the dispatcher's, which
 * applies the policy, the store's own category switch and the person's
 * own mute in one pass. It does not compose the words. It is the seam
 * where "tell this store" becomes "these people, these two channels".
 *
 * NEVER THROWS (NOTIF-1): every caller is already inside a durable fact
 * — a decision recorded, an order changed, a ticket settled — and a
 * notification layer that throws turns a completed operation into a
 * failed one. Awaited by its callers rather than fire-and-forget, so the
 * e2e reset has nothing in flight to drain (NOTIF-19).
 */
@Injectable()
export class StoreNotificationSender {
  private readonly logger = new Logger(StoreNotificationSender.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly env: EnvService,
  ) {}

  async tell(input: TellStoreInput): Promise<void> {
    const audience: readonly AudienceSelector[] = (
      input.permissions ?? STORE_ORDER_PERMISSIONS
    ).map((permission) => ({
      kind: 'STORE_PERMISSION' as const,
      storeId: input.storeId,
      permission,
    }));

    const links = {
      order_url:
        input.orderId === null
          ? this.env.resellerAppUrl
          : `${this.env.resellerAppUrl}/orders/${input.orderId}`,
      app_url: this.env.resellerAppUrl,
    };

    // ONE call, both legs. `resolveMany` dedupes across the three
    // permission selectors, so somebody holding two of them is one
    // person with one inbox and one email.
    try {
      await this.dispatch.dispatch({
        topic: input.topic,
        category: NotificationCategory.OPERATIONAL,
        title: input.title,
        body: input.body,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        audience,
        // The in-app leg's key. The email leg's is `input.eventId`,
        // untouched — see `DispatchInput.email`.
        eventId: `${input.eventId}:inapp`,
        templateCode: input.topic,
        triggerEvent: input.triggerEvent,
        orderId: input.orderId,
        email: {
          templateCode: input.templateCode,
          // The key each notifier was already sending on, UNCHANGED, so
          // no store is re-sent something it has had (NOTIF-2).
          eventId: input.eventId,
          variables: (person) => ({
            full_name: person.name ?? '',
            ...input.variables,
            ...links,
          }),
        },
      });
    } catch (err) {
      this.logger.warn(
        { ref: input.ref, topic: input.topic, err: err instanceof Error ? err.message : err },
        'Could not tell the store',
      );
    }
  }
}
