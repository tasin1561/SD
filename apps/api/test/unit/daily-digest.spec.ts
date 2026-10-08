import { NotificationChannel, OrderStatus, StoreOrderScope } from '@skydrop/db';
import {
  ASSOCIATE_DAILY_DIGEST_TOPIC,
  DailyDigestService,
  isDigestHour,
  localDateLabel,
  previousLocalDay,
} from '../../src/modules/daily-digest/services/daily-digest.service';

/**
 * The digest's two jobs: pick the right day in the right zone, and
 * count parcels rather than events.
 */

function serviceWith(
  events: ReadonlyArray<{ toStatus: OrderStatus; orderNumber: string; placedBy?: string }>,
  options: {
    /** The store's team, as `storePeople` would resolve it. */
    readonly people?: ReadonlyArray<{
      readonly id: string;
      readonly fullName: string;
      readonly scope: StoreOrderScope;
    }>;
    /** What `STORE_PERMISSION orders.view` resolves to, before narrowing. */
    readonly canSeeOrders?: readonly string[];
    readonly stores?: ReadonlyArray<{ id: string; name: string; displayName: string | null }>;
    readonly sellers?: ReadonlyArray<{ id: string; companyName: string }>;
  } = {},
) {
  const prisma = {
    client: {
      orderEvent: {
        findMany: jest.fn().mockResolvedValue(
          events.map((e) => ({
            toStatus: e.toStatus,
            order: { orderNumber: e.orderNumber, placedByStoreUserId: e.placedBy ?? null },
          })),
        ),
      },
      storeUser: {
        findMany: jest.fn().mockResolvedValue(
          (options.people ?? []).map((p) => ({
            id: p.id,
            fullName: p.fullName,
            roles: [{ role: { isOwner: false, orderScope: p.scope, deletedAt: null } }],
          })),
        ),
      },
      seller: { findMany: jest.fn().mockResolvedValue(options.sellers ?? []) },
      sellerStore: { findMany: jest.fn().mockResolvedValue(options.stores ?? []) },
      sellerNotificationPreference: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  };
  const dispatch = { dispatch: jest.fn().mockResolvedValue(undefined) };
  const audience = {
    resolveMany: jest
      .fn()
      .mockResolvedValue((options.canSeeOrders ?? []).map((id) => ({ recipientId: id }))),
  };
  return {
    svc: new DailyDigestService(
      prisma as never,
      dispatch as never,
      audience as never,
      {
        sellerAppUrl: 'https://app.skydrop.global',
        resellerAppUrl: 'https://reseller.skydrop.global',
      } as never,
    ),
    prisma,
    dispatch,
    audience,
  };
}

describe('which hour, and which day', () => {
  // The cron fires at :05 past each hour. Dhaka is UTC+6 and Kolkata
  // UTC+5:30, so the two zones hit their 8 o'clock on DIFFERENT firings
  // — which is the whole reason the pass is hourly and asks each zone
  // rather than picking one and being wrong for the other.
  it('each zone hits its own 8 o’clock, on a different firing', () => {
    const twoOhFive = new Date('2026-10-07T02:05:00Z'); // 08:05 Dhaka, 07:35 Kolkata
    expect(isDigestHour(twoOhFive, 'Asia/Dhaka')).toBe(true);
    expect(isDigestHour(twoOhFive, 'Asia/Kolkata')).toBe(false);

    const threeOhFive = new Date('2026-10-07T03:05:00Z'); // 09:05 Dhaka, 08:35 Kolkata
    expect(isDigestHour(threeOhFive, 'Asia/Dhaka')).toBe(false);
    expect(isDigestHour(threeOhFive, 'Asia/Kolkata')).toBe(true);
  });

  it('every zone passes the digest hour exactly once a day — what makes the hourly pass safe without state', () => {
    for (const tz of ['Asia/Dhaka', 'Asia/Kolkata', 'UTC', 'America/New_York', 'Australia/Eucla']) {
      let hits = 0;
      for (let h = 0; h < 24; h += 1) {
        // :05 — the minute the cron actually fires.
        if (isDigestHour(new Date(Date.UTC(2026, 9, 7, h, 5, 0)), tz)) hits += 1;
      }
      expect({ tz, hits }).toEqual({ tz, hits: 1 });
    }
  });

  it('covers yesterday midnight to midnight, in the reader’s zone', () => {
    // 08:05 on the 7th in Dhaka (UTC+6) → the 6th, 00:00–24:00 Dhaka,
    // which is 2026-10-05T18:00Z to 2026-10-06T18:00Z.
    const day = previousLocalDay(new Date('2026-10-07T02:05:00Z'), 'Asia/Dhaka');
    expect(day.label).toBe('2026-10-06');
    expect(day.from.toISOString()).toBe('2026-10-05T18:00:00.000Z');
    expect(day.to.toISOString()).toBe('2026-10-06T18:00:00.000Z');
    expect(day.to.getTime() - day.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('labels the day in the reader’s zone, not the server’s', () => {
    // 2026-10-06T19:00Z is already the 7th in Dhaka and still the 6th in
    // London. A digest keyed off the server's date would send the wrong
    // day to half the corridor.
    const at = new Date('2026-10-06T19:00:00Z');
    expect(localDateLabel(at, 'Asia/Dhaka')).toBe('2026-10-07');
    expect(localDateLabel(at, 'Europe/London')).toBe('2026-10-06');
  });
});

describe('what it counts', () => {
  const DAY = { from: new Date('2026-10-05T18:00:00Z'), to: new Date('2026-10-06T18:00:00Z') };

  it('counts PARCELS, not events — one order that moved twice is one return', async () => {
    const { svc } = serviceWith([
      { toStatus: OrderStatus.RTO_INITIATED, orderNumber: 'SD-1' },
      { toStatus: OrderStatus.RTO_IN_TRANSIT, orderNumber: 'SD-1' },
      { toStatus: OrderStatus.RTO_RECEIVED, orderNumber: 'SD-1' },
    ]);
    const body = await svc.forSeller('s1', DAY.from, DAY.to);
    expect(body?.counts.returned).toBe(1);
  });

  it('separates the three outcomes', async () => {
    const { svc } = serviceWith([
      { toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-1' },
      { toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-2' },
      { toStatus: OrderStatus.RTO_INITIATED, orderNumber: 'SD-3' },
      { toStatus: OrderStatus.DELIVERY_FAILED, orderNumber: 'SD-4' },
      // A courier-reported refusal IS a non-delivery; the NDR screens
      // count it, so the digest must agree with them.
      { toStatus: OrderStatus.REJECTED_NDR, orderNumber: 'SD-5' },
    ]);
    const body = await svc.forSeller('s1', DAY.from, DAY.to);
    expect(body?.counts).toEqual({ delivered: 2, returned: 1, notDelivered: 2 });
  });

  it('a day where nothing moved sends NOTHING', async () => {
    const { svc } = serviceWith([]);
    expect(await svc.forSeller('s1', DAY.from, DAY.to)).toBeNull();
  });

  it('ignores statuses that are not one of the three', async () => {
    const { svc } = serviceWith([
      { toStatus: OrderStatus.DISPATCHED, orderNumber: 'SD-1' },
      { toStatus: OrderStatus.IN_TRANSIT, orderNumber: 'SD-2' },
    ]);
    // Not "zero of three" — nothing watched happened at all, so no mail.
    expect(await svc.forSeller('s1', DAY.from, DAY.to)).toBeNull();
  });

  it('scopes a seller to their seller id and a store to its store id', async () => {
    const { svc, prisma } = serviceWith([{ toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-1' }]);
    await svc.forSeller('seller-1', DAY.from, DAY.to);
    expect(prisma.client.orderEvent.findMany.mock.calls[0][0].where.order).toMatchObject({
      sellerId: 'seller-1',
    });
    await svc.forStore('store-1', DAY.from, DAY.to);
    expect(prisma.client.orderEvent.findMany.mock.calls[1][0].where.order).toMatchObject({
      storeId: 'store-1',
    });
  });

  it('names a few orders and says how many more, rather than listing hundreds', async () => {
    const { svc } = serviceWith(
      Array.from({ length: 14 }, (_, i) => ({
        toStatus: OrderStatus.DELIVERED,
        orderNumber: `SD-${i}`,
      })),
    );
    const body = await svc.forSeller('s1', DAY.from, DAY.to);
    expect(body?.counts.delivered).toBe(14);
    expect(body?.lines[0]).toContain('and 4 more');
  });
});

describe('ASSOC-1 — who gets which digest', () => {
  /*
    Capability 6 — "get notified everyday about delivered + return +
    ndr/non delivered" — for somebody who sees only what THEY sold.

    Two halves, and the second is the one that would have gone unnoticed:
    an associate gets their own digest, AND is taken OUT of the store's,
    which lists the whole store's day. A digest is exactly where another
    person's order numbers would arrive without anybody thinking of it.
  */
  const DAY = { from: new Date('2026-10-05T18:00:00Z'), to: new Date('2026-10-06T18:00:00Z') };
  /** 08:05 Kolkata — the firing a reseller store's digest goes out on. */
  const AT = new Date('2026-10-07T02:35:00Z');

  function storeWith(
    events: ReadonlyArray<{ toStatus: OrderStatus; orderNumber: string; placedBy?: string }>,
    people: ReadonlyArray<{ id: string; fullName: string; scope: StoreOrderScope }>,
    canSeeOrders: readonly string[],
  ) {
    return serviceWith(events, {
      people,
      canSeeOrders,
      stores: [{ id: 'store-1', name: 'Kurti Bazaar', displayName: null }],
      sellers: [],
    });
  }

  const ASHA = { id: 'u-asha', fullName: 'Asha', scope: StoreOrderScope.OWN };
  const RAVI = { id: 'u-ravi', fullName: 'Ravi', scope: StoreOrderScope.OWN };
  const OWNER = { id: 'u-owner', fullName: 'Nadia', scope: StoreOrderScope.ALL };

  it('narrows a person’s digest through storeOrderOwnerFilter, in the WHERE clause', async () => {
    const { svc, prisma } = storeWith([], [ASHA], []);
    await svc.forStoreUser('store-1', { id: ASHA.id, scope: ASHA.scope }, DAY.from, DAY.to);
    // The filter, not a role-key comparison: somebody holding two roles
    // must see the wider of them, and a comparison at a call site is how
    // the narrow one wins.
    expect(prisma.client.orderEvent.findMany.mock.calls[0][0].where.order).toMatchObject({
      storeId: 'store-1',
      placedByStoreUserId: ASHA.id,
    });
  });

  it('a WIDE person asking for their own digest gets the store’s, unfiltered', async () => {
    // `storeOrderOwnerFilter` returns `{}` for ALL, which adds no
    // condition — the property must be ABSENT, not `undefined`, because
    // the two look identical at a call site and only one of them is a
    // filter somebody can pass null into.
    const { svc, prisma } = storeWith([], [OWNER], []);
    await svc.forStoreUser('store-1', { id: OWNER.id, scope: OWNER.scope }, DAY.from, DAY.to);
    const where = prisma.client.orderEvent.findMany.mock.calls[0][0].where.order;
    expect(Object.keys(where)).not.toContain('placedByStoreUserId');
  });

  it('an associate is taken OUT of the store-wide digest’s audience', async () => {
    const { svc, dispatch } = storeWith(
      [{ toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-1', placedBy: ASHA.id }],
      [ASHA, OWNER],
      [ASHA.id, OWNER.id],
    );
    await svc.runHour(AT);
    const storeWide = dispatch.dispatch.mock.calls
      .map((c) => c[0])
      .find((d) => d.eventId === 'daily-digest:store:store-1:2026-10-06');
    expect(storeWide).toBeDefined();
    // Named people rather than the permission selector, precisely so the
    // narrow ones can be removed. The store's own dedup key is unchanged.
    expect(storeWide.audience).toEqual([{ kind: 'STORE_USER', storeUserId: OWNER.id }]);
  });

  it('a store whose whole team is narrow sends NO store-wide digest at all', async () => {
    const { svc, dispatch } = storeWith(
      [{ toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-1', placedBy: ASHA.id }],
      [ASHA, RAVI],
      [ASHA.id, RAVI.id],
    );
    await svc.runHour(AT);
    const keys = dispatch.dispatch.mock.calls.map((c) => c[0].eventId);
    expect(keys).not.toContain('daily-digest:store:store-1:2026-10-06');
    // Each of them still hears about their own day.
    expect(keys).toContain(`daily-digest:associate:${ASHA.id}:2026-10-06`);
  });

  it('each person’s digest is IN-APP only, on its own topic (NOTIF-23 / NOTIF-14)', async () => {
    const { svc, dispatch } = storeWith(
      [{ toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-1', placedBy: ASHA.id }],
      [ASHA, OWNER],
      [OWNER.id],
    );
    await svc.runHour(AT);
    const mine = dispatch.dispatch.mock.calls
      .map((c) => c[0])
      .find((d) => d.eventId === `daily-digest:associate:${ASHA.id}:2026-10-06`);
    expect(mine).toBeDefined();
    // A store user has an inbox, so this is not also emailed — and with
    // no email leg there must be no email block to render one from.
    expect(mine.channels).toEqual([NotificationChannel.IN_APP]);
    expect(mine.email).toBeUndefined();
    // Its own topic, so one person's mute cannot silence the store's.
    expect(mine.topic).toBe(ASSOCIATE_DAILY_DIGEST_TOPIC);
    expect(mine.topic).not.toBe('daily_digest');
  });

  it('a person who sold nothing yesterday is sent nothing', async () => {
    // The same rule the whole digest runs on: a message that arrives
    // every morning saying "0, 0, 0" is one people stop opening.
    const { svc } = storeWith([], [ASHA], []);
    expect(
      await svc.forStoreUser('store-1', { id: ASHA.id, scope: ASHA.scope }, DAY.from, DAY.to),
    ).toBeNull();
  });

  it('the store’s own digest gains a “who sold what” breakdown', async () => {
    const { svc } = storeWith(
      [
        { toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-1', placedBy: ASHA.id },
        { toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-2', placedBy: ASHA.id },
        { toStatus: OrderStatus.RTO_INITIATED, orderNumber: 'SD-3', placedBy: RAVI.id },
        // Nobody placed this one through a store login — a seller's own
        // order, or staff. It counts in the totals and is attributed to
        // no one, rather than to a row called "Unknown".
        { toStatus: OrderStatus.DELIVERY_FAILED, orderNumber: 'SD-4' },
      ],
      [ASHA, RAVI],
      [],
    );
    const body = await svc.forStore('store-1', DAY.from, DAY.to);
    expect(body?.counts).toEqual({ delivered: 2, returned: 1, notDelivered: 1 });
    const detail = (body?.lines ?? []).join('\n');
    expect(detail).toContain('Who sold what:');
    expect(detail).toContain('Asha: 2 delivered, 0 back, 0 not delivered');
    expect(detail).toContain('Ravi: 0 delivered, 1 back, 0 not delivered');
    expect(detail).not.toContain('Unknown');
  });

  it('a person’s own digest carries no breakdown — it is all theirs', async () => {
    const { svc } = storeWith(
      [{ toStatus: OrderStatus.DELIVERED, orderNumber: 'SD-1', placedBy: ASHA.id }],
      [ASHA],
      [],
    );
    const body = await svc.forStoreUser(
      'store-1',
      { id: ASHA.id, scope: ASHA.scope },
      DAY.from,
      DAY.to,
    );
    expect((body?.lines ?? []).join('\n')).not.toContain('Who sold what');
  });
});
