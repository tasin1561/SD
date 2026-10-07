import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, OrderStatus } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import type { AudienceSelector } from '../../notification-audience/services/notification-audience.service';

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

@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: NotificationDispatchService,
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
      considered += 1;
      const day = previousLocalDay(now, STORE_TIMEZONE);
      const body = await this.forStore(store.id, day.from, day.to);
      if (body === null) {
        quiet += 1;
        continue;
      }
      await this.send({
        audience: [{ kind: 'STORE_PERMISSION', storeId: store.id, permission: 'orders.view' }],
        eventKey: `store:${store.id}:${day.label}`,
        who: store.displayName ?? store.name,
        // The STORE's app, not the seller's — a store user has no login
        // for app.skydrop.global and a link there is a dead end.
        appUrl: this.env.resellerAppUrl,
        day,
        body,
      });
      sent += 1;
    }

    this.logger.log({ considered, sent, quiet }, 'Daily digest pass');
    return { considered, sent, quiet };
  }

  /** A seller's whole business — their own orders AND their stores'. */
  async forSeller(sellerId: string, from: Date, to: Date): Promise<DigestBody | null> {
    return this.build({ sellerId }, from, to);
  }

  /** One reseller store, and only that store. */
  async forStore(storeId: string, from: Date, to: Date): Promise<DigestBody | null> {
    return this.build({ storeId }, from, to);
  }

  private async build(
    scope: { sellerId?: string; storeId?: string },
    from: Date,
    to: Date,
  ): Promise<DigestBody | null> {
    const events = await this.prisma.client.orderEvent.findMany({
      where: {
        toStatus: { in: [...ALL_WATCHED] },
        createdAt: { gte: from, lt: to },
        order: { ...scope, deletedAt: null },
      },
      select: {
        toStatus: true,
        order: { select: { orderNumber: true } },
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
      if (e.toStatus === null) continue;
      if (DELIVERED.includes(e.toStatus) && !seen.delivered.has(n)) {
        seen.delivered.add(n);
        buckets.delivered.push(n);
      } else if (RETURNED.includes(e.toStatus) && !seen.returned.has(n)) {
        seen.returned.add(n);
        buckets.returned.push(n);
      } else if (NOT_DELIVERED.includes(e.toStatus) && !seen.nd.has(n)) {
        seen.nd.add(n);
        buckets.notDelivered.push(n);
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
  }): Promise<void> {
    const { counts } = input.body;
    const title = `Yesterday: ${counts.delivered} delivered, ${counts.returned} back, ${counts.notDelivered} not delivered`;
    const body = input.body.lines.join('\n');
    await this.dispatch.dispatch({
      topic: 'daily_digest',
      // INFORMATIONAL, not OPERATIONAL: it is a summary of things that
      // already have their own alerts, so a reader must be able to turn
      // it off without losing anything they need to act on.
      category: NotificationCategory.INFORMATIONAL,
      title,
      body,
      channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
      audience: input.audience,
      eventId: `daily-digest:${input.eventKey}`,
      triggerEvent: 'daily_digest.sent',
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
