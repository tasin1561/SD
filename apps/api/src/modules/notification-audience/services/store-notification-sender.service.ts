import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, StoreOrderScope } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { storeOrderScope } from '../../../common/auth/store-order-scope';
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
  /**
   * The part of the message that states MONEY, kept separate so it can
   * be withheld.
   *
   * `GET /store/orders/:id/money` answers 403
   * `STORE_MONEY_NOT_FOR_ASSOCIATE` to a narrow-scope store user, and
   * `associate-response-boundary.spec.ts` names `netInr`,
   * `storeNetInr` and `sellerNetInr` as withheld by scope — the store's
   * commercial position against its seller is the one fact ASSOC-1
   * keeps from an associate, and the role's own description promises it
   * ("never sees … the store's money"). A notice that printed the same
   * arithmetic in prose handed over what the route refuses, and did it
   * on a topic nobody can silence (`IMMUTABLE_TOPICS`).
   *
   * Appended to `body` for a store user who may see the money, omitted
   * for one who may not — including on an order they placed themselves,
   * because the 403 refuses it there too.
   */
  readonly moneyLine?: string | undefined;
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
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The store's people whose roles narrow them to their own orders.
   *
   * Read through `storeOrderScope` — never by comparing a role key —
   * because a person holds SEVERAL roles since RBAC-1b and WIDEST WINS:
   * somebody who is both an Associate and an Ops must not be narrowed
   * by the role that was only ever meant to grant more.
   *
   * FAILS OPEN to "nobody is narrow", which is the behaviour before this
   * existed. A notification layer must never throw (NOTIF-1), and the
   * alternative — failing closed and telling nobody — would silently
   * stop a store hearing about its own orders, which is worse than the
   * disclosure this narrows.
   */
  private async narrowScopeUserIds(storeId: string): Promise<ReadonlySet<string>> {
    try {
      const rows = await this.prisma.client.storeUser.findMany({
        where: { storeId, deletedAt: null },
        select: {
          id: true,
          roles: {
            where: { role: { deletedAt: null } },
            select: { role: { select: { isOwner: true, orderScope: true } } },
          },
        },
      });
      const out = new Set<string>();
      for (const r of rows) {
        const scope = storeOrderScope(r.roles.map((x) => x.role));
        if (scope === StoreOrderScope.OWN) out.add(r.id);
      }
      return out;
    } catch (err) {
      this.logger.warn(
        { storeId, err: err instanceof Error ? err.message : err },
        'Could not resolve store order scopes — not narrowing this message',
      );
      return new Set<string>();
    }
  }

  /** Who placed this order, or null when nobody did (a seller's own, a machine key). */
  private async placedBy(orderId: string | null): Promise<string | null> {
    if (orderId === null) return null;
    try {
      const row = await this.prisma.client.order.findUnique({
        where: { id: orderId },
        select: { placedByStoreUserId: true },
      });
      return row?.placedByStoreUserId ?? null;
    } catch {
      return null;
    }
  }

  async tell(input: TellStoreInput): Promise<void> {
    const audience: readonly AudienceSelector[] = (
      input.permissions ?? STORE_ORDER_PERMISSIONS
    ).map((permission) => ({
      kind: 'STORE_PERMISSION' as const,
      storeId: input.storeId,
      permission,
    }));

    // ASSOC-1, APPLIED TO THE NOTIFICATION PATH.
    //
    // The audience is "who at this store holds this permission", and an
    // associate holds all three order permissions because they PLACE
    // orders. Their scope says they see only the ones they placed, and
    // that rule was enforced in a `where` clause on every screen and
    // nowhere here — so a notice about a colleague's order reached them
    // with its order number, its customer's details, and on the god-mode
    // path the store's and the seller's net credit.
    //
    // `daily-digest` had already asked this question and answered it, for
    // the stated reason that "a digest is exactly where it would go
    // unnoticed". An inbox line is the same place.
    //
    // Resolved HERE rather than in `resolveMany`, which has no order in
    // hand: dropping narrow-scope people there would also suppress the
    // notices an associate SHOULD get about their own sales, which
    // inverts the rule instead of applying it.
    const narrow = await this.narrowScopeUserIds(input.storeId);
    const placedBy = await this.placedBy(input.orderId);
    const maySeeThisOrder = (recipientId: string): boolean => {
      if (!narrow.has(recipientId)) return true; // ALL scope — unchanged.
      // A message about no particular order (terms, wallet) still
      // reaches them; one about an order reaches only its placer.
      if (input.orderId === null) return true;
      return placedBy !== null && placedBy === recipientId;
    };

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
        // The money-free body is the DEFAULT, so a future caller that
        // forgets `moneyLine` withholds rather than leaks.
        body: input.body,
        bodyFor: (person) =>
          input.moneyLine !== undefined && !narrow.has(person.recipientId)
            ? `${input.body} ${input.moneyLine}`.trim()
            : input.body,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        audience,
        recipientFilter: (person) => maySeeThisOrder(person.recipientId),
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
            // The EMAIL leg renders `{{ money }}` on the god-mode
            // template, and that template is NOT retired — so the one
            // figure-bearing path is also the one that leaves the
            // building. Blanked for the same readers the in-app body
            // withholds it from; the template degrades to the rest of
            // the sentence rather than printing "undefined".
            ...(narrow.has(person.recipientId) ? { money: '' } : {}),
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
