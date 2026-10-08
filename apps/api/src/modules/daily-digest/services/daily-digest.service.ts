import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannel,
  OrderStatus,
  StoreOrderScope,
} from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { storeOrderOwnerFilter, storeOrderScope } from '../../../common/auth/store-order-scope';
import { NotificationAudienceService } from '../../notification-audience/services/notification-audience.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import type { AudienceSelector } from '../../notification-audience/services/notification-audience.service';

/**
 * ASSOC-1 capability 6 — "get notified everyday about delivered + return
 * + ndr/non delivered", for ONE of the store's sales people.
 *
 * Its OWN topic rather than the store's `daily_digest`, because it is a
 * different message to a different audience: the store's digest is the
 * store's whole day, this one is what THIS person sold. Sharing a key
 * would mean a person silencing one silenced the other, and the NOTIF-2
 * dedup gate would let whichever went first consume the other's slot.
 */
export const ASSOCIATE_DAILY_DIGEST_TOPIC = 'store.daily_digest';

/**
 * "Tell me once a day how yesterday went."
 *
 * ── WHAT WAS THERE BEFORE, AND WHY IT WAS WORSE THAN NOTHING ─────────
 * `NotificationFrequency.DAILY_DIGEST` has been in the enum, on the
 * preferences table and on the settings screen since the start. It was
 * read in exactly ONE place in the whole API — as the default frequency
 * for the MARKETING category — and nothing anywhere batched a send
 * because of it. So a seller could choose a daily digest, the choice
 * saved, and every notification kept arriving one at a time. A setting
 * that is stored and ignored is worse than a missing one: the screen
 * says the system agreed.
 *
 * This is the digest that setting always implied. It does NOT replace
 * the per-event emails — `seller.order_delivered.email` and its
 * siblings still go out as things happen — because a courier failing a
 * delivery is worth knowing within the hour, not tomorrow morning. This
 * answers the different question: what happened yesterday, in one
 * message, so nobody has to reconstruct it from an inbox.
 *
 * ── THE THREE THINGS IT COUNTS ───────────────────────────────────────
 * Delivered, returned and not delivered. Those are the three outcomes a
 * seller or a store actually acts on: the first is money, the second is
 * stock coming back, and the third is somebody to ring.
 */

/** Reached the customer. */
const DELIVERED: readonly OrderStatus[] = [OrderStatus.DELIVERED];

/**
 * Coming back, at any stage of coming back.
 *
 * Every RTO status counts, not just `RTO_INITIATED`: a parcel can be
 * initiated one day and received the next, and a reader who saw only
 * the first would think nothing had moved since.
 */
const RETURNED: readonly OrderStatus[] = [
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
];

/**
 * The courier tried and could not deliver — an NDR.
 *
 * `REJECTED_NDR` is in here because a refusal the courier reports IS a
 * non-delivery; leaving it out would have the digest disagree with the
 * NDR screens about the same parcel.
 */
const NOT_DELIVERED: readonly OrderStatus[] = [
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.REJECTED_NDR,
];

const ALL_WATCHED = [...DELIVERED, ...RETURNED, ...NOT_DELIVERED];

/**
 * Local hour at which the digest goes out.
 *
 * 08:00 in the READER's own timezone, which is why the job runs hourly
 * rather than once a day: each timezone passes 08:00 exactly once in
 * twenty-four hours, so an hourly sweep that only acts on the matching
 * hour needs no "did we already send today" state to get it right. A
 * single daily cron would have had to pick one zone and be wrong for
 * everybody else — and the corridor spans two.
 */
const DIGEST_LOCAL_HOUR = 8;

/** Reseller stores sell in India and keep no timezone of their own. */
const STORE_TIMEZONE = 'Asia/Kolkata';

/** Enough to name names; past this the message is a spreadsheet. */
const MAX_LISTED = 10;

export interface DigestCounts {
  readonly delivered: number;
  readonly returned: number;
  readonly notDelivered: number;
}

export interface DigestRun {
  readonly considered: number;
  readonly sent: number;
  readonly quiet: number;
}

interface DigestBody {
  readonly counts: DigestCounts;
  readonly lines: readonly string[];
}

/** Which orders a digest counts. Spread straight into the order filter. */
interface DigestScope {
  readonly sellerId?: string;
  readonly storeId?: string;
  /** ASSOC-1 — set only by `storeOrderOwnerFilter`, never by hand. */
  readonly placedByStoreUserId?: string;
}

/** One of a reseller store's people, with the scope their roles resolve to. */
interface StorePerson {
  readonly id: string;
  readonly name: string;
  readonly scope: StoreOrderScope;
}

@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
    // ASSOC-1 — the store digest's audience has to be resolved HERE so
    // the narrow-scope people can be taken out of it before it is sent.
    // Asking the audience service rather than re-deriving "who may see
    // orders" keeps the permission half in its one place; all that is
    // added is the subtraction.
    private readonly audience: NotificationAudienceService,
    private readonly env: EnvService,
  ) {}

  /**
   * One hourly pass. Sends to every seller and every reseller store for
   * which it is now `DIGEST_LOCAL_HOUR` locally.
   */
  async runHour(now: Date = new Date()): Promise<DigestRun> {
    const sellers = await this.prisma.client.seller.findMany({
      where: { deletedAt: null },
      select: { id: true, companyName: true },
    });
    const stores = await this.prisma.client.sellerStore.findMany({
      where: { deletedAt: null, kind: 'RESELLER' },
      select: { id: true, name: true, displayName: true },
    });

    let considered = 0;
    let sent = 0;
    let quiet = 0;

    for (const seller of sellers) {
      // Per-seller, because the preferences row carries a timezone and a
      // seller who set one meant it.
      const tz = await this.timezoneForSeller(seller.id);
      if (!isDigestHour(now, tz)) continue;
      considered += 1;
      const day = previousLocalDay(now, tz);
      const body = await this.forSeller(seller.id, day.from, day.to);
      if (body === null) {
        quiet += 1;
        continue;
      }
      await this.send({
        audience: [{ kind: 'SELLER_PERMISSION', sellerId: seller.id, permission: 'orders.view' }],
        eventKey: `seller:${seller.id}:${day.label}`,
        who: seller.companyName,
        appUrl: this.env.sellerAppUrl,
        day,
        body,
      });
      sent += 1;
    }

    for (const store of stores) {
      if (!isDigestHour(now, STORE_TIMEZONE)) continue;
      const day = previousLocalDay(now, STORE_TIMEZONE);
      const people = await this.storePeople(store.id);
      const narrow = people.filter((p) => p.scope === StoreOrderScope.OWN);
      const storeName = store.displayName ?? store.name;

      // ── The store's own digest — the whole store's day ──────────────
      //
      // Its audience is still "whoever at this store may see orders",
      // resolved the way every other notification resolves it, MINUS the
      // people whose scope is OWN. An associate reading the store's
      // digest would be reading a list of other people's order numbers,
      // which is the one thing `order_scope` exists to stop (ASSOC-1
      // capability 3) — and a digest is exactly where it would go
      // unnoticed, because nothing on it looks like somebody else's.
      const narrowIds = new Set(narrow.map((p) => p.id));
      const wide = (
        await this.audience.resolveMany([
          { kind: 'STORE_PERMISSION', storeId: store.id, permission: 'orders.view' },
        ])
      ).filter((r) => !narrowIds.has(r.recipientId));
      if (wide.length > 0) {
        considered += 1;
        const body = await this.forStore(store.id, day.from, day.to, people);
        if (body === null) quiet += 1;
        else {
          await this.send({
            // Named people rather than the permission selector, so the
            // narrow ones can be removed — but the dedup key stays the
            // STORE's. It is the same message it always was, and NOTIF-2's
            // key already carries the recipient, so per-person keys would
            // buy nothing and re-send yesterday's digest to everybody once.
            audience: wide.map((r) => ({ kind: 'STORE_USER', storeUserId: r.recipientId })),
            eventKey: `store:${store.id}:${day.label}`,
            who: storeName,
            // The STORE's app, not the seller's — a store user has no login
            // for app.skydrop.global and a link there is a dead end.
            appUrl: this.env.resellerAppUrl,
            day,
            body,
          });
          sent += 1;
        }
      }

      // ── Each narrow person's own digest — only what THEY sold ───────
      for (const person of narrow) {
        considered += 1;
        const body = await this.forStoreUser(store.id, person, day.from, day.to);
        if (body === null) {
          quiet += 1;
          continue;
        }
        await this.send({
          audience: [{ kind: 'STORE_USER', storeUserId: person.id }],
          eventKey: `associate:${person.id}:${day.label}`,
          who: storeName,
          appUrl: this.env.resellerAppUrl,
          day,
          body,
          topic: ASSOCIATE_DAILY_DIGEST_TOPIC,
          // NOTIF-23 — IN-APP ONLY. A store user has an inbox, and a
          // message with an inbox behind it is not also emailed. There
          // is deliberately no template for this one, so there is
          // nothing for `RETIRED_EMAIL_TEMPLATES` to map: an email leg
          // that never existed cannot be retired, and adding one later
          // would mean adding its entry in the same change.
          channels: [NotificationChannel.IN_APP],
        });
        sent += 1;
      }
    }

    this.logger.log({ considered, sent, quiet }, 'Daily digest pass');
    return { considered, sent, quiet };
  }

  /** A seller's whole business — their own orders AND their stores'. */
  async forSeller(sellerId: string, from: Date, to: Date): Promise<DigestBody | null> {
    return this.build({ sellerId }, from, to);
  }

  /**
   * One reseller store, and only that store.
   *
   * `people` is the team `runHour` has already loaded — passed in rather
   * than re-read, because the only other way to name who sold what is a
   * second identical query per store per hour.
   */
  async forStore(
    storeId: string,
    from: Date,
    to: Date,
    people?: readonly StorePerson[],
  ): Promise<DigestBody | null> {
    const team = people ?? (await this.storePeople(storeId));
    return this.build({ storeId }, from, to, new Map(team.map((p) => [p.id, p.name])));
  }

  /**
   * One PERSON at a reseller store, narrowed by their own order scope.
   *
   * Scoped through `storeOrderOwnerFilter` and never by comparing a role
   * key: somebody holding two roles must see the WIDER of the two, and a
   * comparison at a call site is how the narrow one wins (ASSOC-1). A
   * person whose scope resolves to ALL gets no filter at all here, which
   * is why this is safe to call for anybody — though `runHour` only ever
   * calls it for the narrow ones, so they are not sent the same day
   * twice under two different topics.
   */
  async forStoreUser(
    storeId: string,
    person: { readonly id: string; readonly scope: StoreOrderScope },
    from: Date,
    to: Date,
  ): Promise<DigestBody | null> {
    return this.build(
      { storeId, ...storeOrderOwnerFilter({ scope: person.scope, storeUserId: person.id }) },
      from,
      to,
    );
  }

  /**
   * One reseller store's live team, each with the scope their ROLES
   * resolve to.
   *
   * Read from the same rows the guard reads (`store_user_roles` →
   * `store_roles.order_scope`, soft-deleted roles excluded) and resolved
   * by the same function, so the digest and the order screens cannot
   * disagree about what a person may see.
   */
  private async storePeople(storeId: string): Promise<readonly StorePerson[]> {
    const rows = await this.prisma.client.storeUser.findMany({
      where: { storeId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        roles: {
          select: { role: { select: { isOwner: true, orderScope: true, deletedAt: true } } },
        },
      },
    });
    return rows.map((u) => ({
      id: u.id,
      name: u.fullName,
      scope: storeOrderScope(u.roles.map((r) => r.role).filter((r) => r.deletedAt === null)),
    }));
  }

  private async build(
    scope: DigestScope,
    from: Date,
    to: Date,
    placerNames?: ReadonlyMap<string, string>,
  ): Promise<DigestBody | null> {
    const events = await this.prisma.client.orderEvent.findMany({
      where: {
        toStatus: { in: [...ALL_WATCHED] },
        createdAt: { gte: from, lt: to },
        order: { ...scope, deletedAt: null },
      },
      select: {
        toStatus: true,
        // ASSOC-1 — WHO placed it, for the store's "by person" breakdown.
        // Null is the ordinary answer and means "no store user placed
        // this": a seller's own order, staff, a store API key, or any
        // order placed before the column existed. Never "unknown".
        order: { select: { orderNumber: true, placedByStoreUserId: true } },
      },
      // A day that somehow produced thousands is a day to read on the
      // screen, not in an email; the cap keeps one bad day from mailing
      // a megabyte.
      take: 5000,
      orderBy: { createdAt: 'asc' },
    });

    const buckets = {
      delivered: [] as string[],
      returned: [] as string[],
      notDelivered: [] as string[],
    };
    /** Per placer, the same three counts — for the store's breakdown. */
    const byPlacer = new Map<string, DigestCounts>();
    const bump = (who: string | null, key: keyof DigestCounts): void => {
      if (who === null) return;
      const at = byPlacer.get(who) ?? { delivered: 0, returned: 0, notDelivered: 0 };
      byPlacer.set(who, { ...at, [key]: at[key] + 1 });
    };
    // An order that moved twice in a day (initiated then received) is ONE
    // returned parcel, not two — counting events would overstate every
    // figure in the message.
    const seen = {
      delivered: new Set<string>(),
      returned: new Set<string>(),
      nd: new Set<string>(),
    };
    for (const e of events) {
      const n = e.order.orderNumber;
      const who = e.order.placedByStoreUserId;
      if (e.toStatus === null) continue;
      if (DELIVERED.includes(e.toStatus) && !seen.delivered.has(n)) {
        seen.delivered.add(n);
        buckets.delivered.push(n);
        bump(who, 'delivered');
      } else if (RETURNED.includes(e.toStatus) && !seen.returned.has(n)) {
        seen.returned.add(n);
        buckets.returned.push(n);
        bump(who, 'returned');
      } else if (NOT_DELIVERED.includes(e.toStatus) && !seen.nd.has(n)) {
        seen.nd.add(n);
        buckets.notDelivered.push(n);
        bump(who, 'notDelivered');
      }
    }

    const counts: DigestCounts = {
      delivered: buckets.delivered.length,
      returned: buckets.returned.length,
      notDelivered: buckets.notDelivered.length,
    };
    // NOTHING HAPPENED MEANS NO EMAIL. A message that arrives every
    // morning saying "0, 0, 0" is one people stop opening, and the day it
    // matters they will not open it either.
    if (counts.delivered + counts.returned + counts.notDelivered === 0) return null;

    return {
      counts,
      lines: [
        line('Delivered', buckets.delivered),
        line('Came back', buckets.returned),
        line('Not delivered', buckets.notDelivered),
        // ASSOC-1 — who sold what, appended only when somebody can be
        // named. A store with no associates places every order through
        // the owner's own login, so this would otherwise add a heading
        // and one line that restates the three above it.
        ...placedByLines(byPlacer, placerNames),
      ].filter((l): l is string => l !== null),
    };
  }

  private async send(input: {
    audience: readonly AudienceSelector[];
    eventKey: string;
    who: string;
    appUrl: string;
    day: LocalDay;
    body: DigestBody;
    /** Defaults to the estate-wide digest topic. */
    topic?: string;
    /** Defaults to both legs. In-app only for the ones with no template. */
    channels?: readonly NotificationChannel[];
  }): Promise<void> {
    const { counts } = input.body;
    const title = `Yesterday: ${counts.delivered} delivered, ${counts.returned} back, ${counts.notDelivered} not delivered`;
    const body = input.body.lines.join('\n');
    const channels = input.channels ?? [NotificationChannel.EMAIL, NotificationChannel.IN_APP];
    const emailed = channels.includes(NotificationChannel.EMAIL);
    await this.dispatch.dispatch({
      topic: input.topic ?? 'daily_digest',
      // INFORMATIONAL, not OPERATIONAL: it is a summary of things that
      // already have their own alerts, so a reader must be able to turn
      // it off without losing anything they need to act on.
      category: NotificationCategory.INFORMATIONAL,
      title,
      body,
      channels,
      audience: input.audience,
      eventId: `daily-digest:${input.eventKey}`,
      triggerEvent: 'daily_digest.sent',
      // SPREAD-WHEN-PRESENT rather than `email: undefined`: under
      // `exactOptionalPropertyTypes` the two are different types, and an
      // email block handed to an in-app-only send would be a template
      // rendered for a leg that never goes out.
      ...(emailed
        ? {
            email: {
              templateCode: 'daily.digest.email',
              // Its OWN key: NOTIF-14 — the two legs of one notification never
              // share one, or deduping the email silences the inbox line too.
              eventId: `daily-digest-email:${input.eventKey}`,
              variables: () => ({
                who: input.who,
                day: input.day.label,
                delivered: String(counts.delivered),
                returned: String(counts.returned),
                not_delivered: String(counts.notDelivered),
                detail: body,
                app_url: input.appUrl,
              }),
            },
          }
        : {}),
    });
  }

  /** The seller's own timezone, or the corridor's default. */
  private async timezoneForSeller(sellerId: string): Promise<string> {
    const pref = await this.prisma.client.sellerNotificationPreference.findFirst({
      where: { sellerId },
      select: { timezone: true },
      orderBy: { updatedAt: 'desc' },
    });
    return pref?.timezone ?? 'Asia/Dhaka';
  }
}

function line(label: string, numbers: readonly string[]): string | null {
  if (numbers.length === 0) return null;
  const shown = numbers.slice(0, MAX_LISTED).join(', ');
  const rest = numbers.length - MAX_LISTED;
  return rest > 0
    ? `${label} (${numbers.length}): ${shown} and ${rest} more`
    : `${label} (${numbers.length}): ${shown}`;
}

/**
 * "Who sold what", for the store's own digest.
 *
 * Only people the store can NAME: an order with no `placedByStoreUserId`
 * is not an order by an unknown person, it is an order no store user
 * placed (ORD-6 / ASSOC-1 — a seller's own, staff's, or a store API
 * key's), and a row called "Unknown" would invite somebody to go looking
 * for them. Those orders are still in the three totals above; they are
 * simply not attributed.
 */
function placedByLines(
  byPlacer: ReadonlyMap<string, DigestCounts>,
  names?: ReadonlyMap<string, string>,
): readonly string[] {
  if (names === undefined || byPlacer.size === 0) return [];
  const rows = [...byPlacer.entries()]
    .flatMap(([id, c]) => {
      const name = names.get(id);
      return name === undefined ? [] : [{ name, c }];
    })
    .sort((a, b) => b.c.delivered - a.c.delivered || a.name.localeCompare(b.name));
  if (rows.length === 0) return [];
  return [
    'Who sold what:',
    ...rows.map(
      (r) =>
        `  ${r.name}: ${r.c.delivered} delivered, ${r.c.returned} back, ${r.c.notDelivered} not delivered`,
    ),
  ];
}

export interface LocalDay {
  readonly from: Date;
  readonly to: Date;
  /** `YYYY-MM-DD` in the reader's zone — also the dedup key's day part. */
  readonly label: string;
}

/** The hour of `at` in `timeZone`, 0–23. */
export function localHour(at: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(at);
  return Number(h);
}

export function isDigestHour(at: Date, timeZone: string): boolean {
  return localHour(at, timeZone) === DIGEST_LOCAL_HOUR;
}

/** `YYYY-MM-DD` for `at` in `timeZone`. */
export function localDateLabel(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Midnight-to-midnight of the day BEFORE `at`, in `timeZone`.
 *
 * Built from the zone's own offset at that moment rather than from a
 * fixed number of hours, so a day is still a day across a DST change.
 */
export function previousLocalDay(at: Date, timeZone: string): LocalDay {
  const label = localDateLabel(new Date(at.getTime() - 24 * 60 * 60 * 1000), timeZone);
  const from = zonedMidnight(label, timeZone);
  const to = zonedMidnight(localDateLabel(at, timeZone), timeZone);
  return { from, to, label };
}

/** The instant at which `YYYY-MM-DD` begins in `timeZone`. */
function zonedMidnight(dayLabel: string, timeZone: string): Date {
  // Guess UTC midnight, measure how far that lands from midnight in the
  // zone, and correct. Two passes settle it even when the offset itself
  // changes across the boundary.
  let guess = new Date(`${dayLabel}T00:00:00Z`);
  for (let i = 0; i < 2; i += 1) {
    const seen = new Date(
      new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .format(guess)
        .replace(' ', 'T') + 'Z',
    );
    guess = new Date(
      guess.getTime() - (seen.getTime() - new Date(`${dayLabel}T00:00:00Z`).getTime()),
    );
  }
  return guess;
}
