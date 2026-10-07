import { OrderStatus } from '@skydrop/db';
import {
  DailyDigestService,
  isDigestHour,
  localDateLabel,
  previousLocalDay,
} from '../../src/modules/daily-digest/services/daily-digest.service';

/**
 * The digest's two jobs: pick the right day in the right zone, and
 * count parcels rather than events.
 */

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
  function serviceWith(events: ReadonlyArray<{ toStatus: OrderStatus; orderNumber: string }>) {
    const prisma = {
      client: {
        orderEvent: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              events.map((e) => ({ toStatus: e.toStatus, order: { orderNumber: e.orderNumber } })),
            ),
        },
      },
    };
    const dispatch = { dispatch: jest.fn().mockResolvedValue(undefined) };
    return {
      svc: new DailyDigestService(
        prisma as never,
        dispatch as never,
        {
          sellerAppUrl: 'https://app.skydrop.global',
          resellerAppUrl: 'https://reseller.skydrop.global',
        } as never,
      ),
      prisma,
      dispatch,
    };
  }
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
