import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, StoreOrderScope } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { storeOrderScope } from '../../../common/auth/store-order-scope';
import { liveRoleKeys, storeConsoleUrl } from '../../../common/auth/store-console-url';
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
  /**
   * Template variables that are a LINK INTO THE STORE CONSOLE, given as
   * the PATH alone (`/tickets/<id>`) — never a whole URL.
   *
   * The origin is not the caller's to choose: which console a store user
   * signs in to depends on WHO is reading, and one message goes to
   * several people (see `linksFor`). A caller that built the URL itself
   * would have to pick one origin for all of them, which is exactly the
   * defect this exists to remove. So the caller says WHERE in the
   * console, and the sender says WHICH console, per person.
   *
   * Spread after `variables`, so a caller that still passes a whole URL
   * under the same name is overridden rather than silently winning.
   */
  readonly linkPaths?: Readonly<Record<string, string>>;
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
   * TWO facts about the store's people, from ONE read of their roles.
   *
   * ── WHAT THEY MAY SEE, and WHERE THEY SIGN IN ────────────────────────
   * Both are answered off the same rows and they are NOT the same
   * question, so each is answered by its own authority:
   *
   *   · `narrow` — whose roles narrow them to their own orders. Read
   *     through `storeOrderScope` (`store_roles.order_scope`), never by
   *     comparing a role key, because a person holds SEVERAL roles since
   *     RBAC-1b and WIDEST WINS: somebody who is both an Associate and
   *     an Ops must not be narrowed by the role that was only ever meant
   *     to grant more.
   *   · `console` — which app a link should point at. Read through
   *     `storeConsoleUrl` over that person's LIVE role keys — the ONE
   *     reader of ASSOC-1's console rule.
   *
   * They coincide today (of the six fixed store roles, exactly
   * `associate` is OWN) and deliberately are not DERIVED from each
   * other. Inferring the console from the scope would make this a second
   * place that decides where a store user signs in, which is precisely
   * what `store-console-url.ts` was extracted to stop — and the day a
   * second narrow role exists (`store-order-scope.ts` names that case)
   * the inference would start mailing those people links into an app
   * they have no login for.
   *
   * FAILS OPEN on both counts: nobody is narrow, and nobody has a known
   * console — so `linksFor` falls back to the WIDE one, which is both
   * `storeConsoleUrl([])` and the behaviour before any of this existed.
   * A notification layer must never throw (NOTIF-1), and the
   * alternative — failing closed and telling nobody — would silently
   * stop a store hearing about its own orders, which is worse than the
   * disclosure this narrows.
   */
  private async storePeopleFacts(storeId: string): Promise<{
    readonly narrow: ReadonlySet<string>;
    readonly consoleByUserId: ReadonlyMap<string, string>;
  }> {
    const narrow = new Set<string>();
    const consoleByUserId = new Map<string, string>();
    try {
      const rows = await this.prisma.client.storeUser.findMany({
        where: { storeId, deletedAt: null },
        select: {
          id: true,
          roles: {
            where: { role: { deletedAt: null } },
            select: {
              role: { select: { key: true, deletedAt: true, isOwner: true, orderScope: true } },
            },
          },
        },
      });
      for (const r of rows) {
        if (storeOrderScope(r.roles.map((x) => x.role)) === StoreOrderScope.OWN) narrow.add(r.id);
        // `liveRoleKeys` takes the JOIN rows, not the unwrapped roles,
        // and re-applies the `deletedAt` filter the query already made.
        // Kept because it is the module's own contract: the day somebody
        // loosens that `where`, the console answer must not widen with
        // it.
        consoleByUserId.set(r.id, storeConsoleUrl(liveRoleKeys(r.roles), this.env));
      }
    } catch (err) {
      this.logger.warn(
        { storeId, err: err instanceof Error ? err.message : err },
        'Could not resolve store roles — not narrowing this message, linking to the wide console',
      );
      narrow.clear();
      consoleByUserId.clear();
    }
    return { narrow, consoleByUserId };
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
    const { narrow, consoleByUserId } = await this.storePeopleFacts(input.storeId);
    const placedBy = await this.placedBy(input.orderId);
    const maySeeThisOrder = (recipientId: string): boolean => {
      if (!narrow.has(recipientId)) return true; // ALL scope — unchanged.
      // A message about no particular order (terms, wallet) still
      // reaches them; one about an order reaches only its placer.
      if (input.orderId === null) return true;
      return placedBy !== null && placedBy === recipientId;
    };

    // ASSOC-1 — EVERY LINK IS PER PERSON, because the console is.
    //
    // This was one constant built from `resellerAppUrl` and spread into
    // every recipient's variables. A store user's ROLE decides which
    // console they sign in to, not their store (`store-console-url.ts`),
    // so one origin for the whole audience is wrong for any associate in
    // it — and `__Host-storeRefresh` is bound to the origin that set it,
    // so the link does not merely look odd: it lands them on an app that
    // refuses almost every page they then open, carrying a session that
    // cannot follow them across.
    //
    // It was LIVE, not hypothetical. `store.order_changed_by_admin.email`
    // is not retired, and `maySeeThisOrder` deliberately passes an
    // associate for an order they placed — so an associate whose own
    // order Skydrop had changed was emailed a link into the reseller
    // console. `apps/associate` has `/orders/[id]`, so only the host was
    // ever wrong.
    //
    // Keyed on the person's own live ROLES rather than on `narrow` just
    // above. The two sets are the same today and answer different
    // questions: `narrow` is what they may SEE (`order_scope`), this is
    // where they sign IN. Deriving one from the other is the second
    // reader `store-console-url.ts` exists to prevent.
    const linksFor = (recipientId: string): EmailVariables => {
      // The unknown case is asked of the module rather than restated as
      // `resellerAppUrl`: it already decides what "no live roles" means,
      // and a literal here would be a second answer to drift from it.
      const base = consoleByUserId.get(recipientId) ?? storeConsoleUrl([], this.env);
      const paths = Object.fromEntries(
        Object.entries(input.linkPaths ?? {}).map(([name, path]) => [name, `${base}${path}`]),
      );
      return {
        order_url: input.orderId === null ? base : `${base}/orders/${input.orderId}`,
        app_url: base,
        ...paths,
      };
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
            // LAST, so a caller that pre-built a link under one of these
            // names is corrected rather than left to win.
            ...linksFor(person.recipientId),
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
