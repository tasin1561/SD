import { HttpException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  courierTryOrder,
  ExternalShapeError,
  isPlausibleAwb,
  mapDelhivery,
  mapShiprocket,
  safeText,
} from '../../src/modules/tracking-public/services/external-tracking.mappers';
import {
  EXTERNAL_TRACKING_LIMITS,
  ExternalTrackingService,
} from '../../src/modules/tracking-public/services/external-tracking.service';
import { PublicTrackingLookupService } from '../../src/modules/tracking-public/services/public-tracking-lookup.service';
import type { PublicTrackingResponse } from '../../src/modules/tracking-public/dto/public-tracking.response.dto';

const fx = (n: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '../fixtures/external-tracking', n), 'utf8'));

const ALLOWED_KEYS = [
  'awbNumber',
  'courier',
  'courierDisplayName',
  'currentStatus',
  'currentStatusAt',
  'destinationCity',
  'estimatedDeliveryAt',
  'source',
  'timeline',
];

class FakeRedis {
  store = new Map<string, string>();
  ttl = new Map<string, number>();
  client = {
    get: async (k: string) => this.store.get(k) ?? null,
    set: async (k: string, v: string, _ex?: string, sec?: number) => {
      this.store.set(k, v);
      if (sec) this.ttl.set(k, sec);
      return 'OK';
    },
    incr: async (k: string) => {
      const n = Number(this.store.get(k) ?? '0') + 1;
      this.store.set(k, String(n));
      return n;
    },
    expire: async () => 1,
    del: async (k: string) => (this.store.delete(k) ? 1 : 0),
  };
}

function make(isTest = false) {
  const redis = new FakeRedis();
  const raise = jest.fn(async () => undefined);
  const svc = new ExternalTrackingService(redis as never, { raise } as never, { isTest } as never);
  return { svc, redis, raise };
}

function mockFetch(handler: (url: string) => { status?: number; body?: unknown }) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const r = handler(String(input));
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
}

afterEach(() => jest.restoreAllMocks());

describe('external tracking mappers', () => {
  it('maps the captured Delhivery payload and exposes only allow-listed keys', () => {
    const v = mapDelhivery(fx('delhivery-returned.json'), '38061110627384');
    if (v === 'NOT_FOUND') throw new Error('expected a view');
    expect(v.currentStatus).toBe('returning');
    expect(v.destinationCity).toBe('Patiala');
    expect(v.estimatedDeliveryAt).toBeNull(); // a return has no delivery ETA
    expect(v.timeline[0]).toMatchObject({ locationCity: 'Rajpura' });
    const text = JSON.stringify(v);
    expect(text).not.toContain('REDACTED-REF');
    expect(text).not.toContain('COD');
    expect(Object.keys(v).every((k) => ALLOWED_KEYS.includes(k))).toBe(true);
  });

  it('Delhivery empty data is NOT_FOUND; a missing data array is a shape error', () => {
    expect(mapDelhivery(fx('delhivery-unknown.json'), 'x')).toBe('NOT_FOUND');
    expect(() => mapDelhivery({ foo: 1 }, 'x')).toThrow(ExternalShapeError);
  });

  it('Shiprocket track_status 0 is NOT_FOUND', () => {
    expect(mapShiprocket(fx('shiprocket-unknown.json'), 'x')).toBe('NOT_FOUND');
    expect(() => mapShiprocket({}, 'x')).toThrow(ExternalShapeError);
  });

  it('maps a Shiprocket payload (synthetic), newest first, no PII', () => {
    const v = mapShiprocket(fx('shiprocket-synthetic-with-scans.json'), 'SRSC0000000001');
    if (v === 'NOT_FOUND') throw new Error('expected a view');
    expect(v.currentStatus).toBe('delivered');
    expect(v.timeline.map((t) => t.status)).toEqual([
      'delivered',
      'out_for_delivery',
      'in_transit',
    ]);
    expect(v.destinationCity).toBe('Mumbai');
    const text = JSON.stringify(v);
    expect(text).not.toContain('Test Person');
    expect(text).not.toContain('9876543210');
    expect(Object.keys(v).every((k) => ALLOWED_KEYS.includes(k))).toBe(true);
  });

  it('detects the courier order by AWB pattern', () => {
    expect(courierTryOrder('38061110627384')).toEqual(['delhivery', 'shiprocket']);
    expect(courierTryOrder('SRSC9462186292')).toEqual(['shiprocket', 'delhivery']);
    expect(isPlausibleAwb('../etc')).toBe(false);
    expect(isPlausibleAwb('38061110627384')).toBe(true);
  });

  it('safeText strips phone numbers and emails', () => {
    expect(safeText('Call +91 98765 43210 or a@b.com now')).toBe('Call or now');
  });
});

describe('ExternalTrackingService', () => {
  const AWB = '38061110627384';

  it('serves from cache (one upstream call) and caches found for 10 min', async () => {
    const { svc, redis } = make();
    const f = mockFetch(() => ({ body: fx('delhivery-returned.json') }));
    const a = await svc.lookup(AWB, '1.1.1.1');
    const b = await svc.lookup(AWB, '1.1.1.1');
    expect(a?.source).toBe('COURIER_PUBLIC');
    expect(a?.courier).toBe('delhivery');
    expect(b).toEqual(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(redis.ttl.get(`trk:ext:v1:${AWB}`)).toBe(EXTERNAL_TRACKING_LIMITS.cacheFoundSec);
  });

  it('not found at both couriers returns null, cached for 2 min', async () => {
    const { svc, redis } = make();
    const f = mockFetch((u) =>
      u.includes('delhivery')
        ? { body: fx('delhivery-unknown.json') }
        : { body: fx('shiprocket-unknown.json') },
    );
    expect(await svc.lookup(AWB, 'ip')).toBeNull();
    expect(await svc.lookup(AWB, 'ip')).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
    expect(redis.ttl.get(`trk:ext:v1:${AWB}`)).toBe(EXTERNAL_TRACKING_LIMITS.cacheMissSec);
  });

  it('never calls a courier under the test environment', async () => {
    const { svc } = make(true);
    const f = mockFetch(() => ({ body: {} }));
    expect(await svc.lookup(AWB, 'ip')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('limits to 20 uncached lookups per minute per IP, with a friendly 429', async () => {
    const { svc } = make();
    mockFetch((u) =>
      u.includes('delhivery')
        ? { body: fx('delhivery-unknown.json') }
        : { body: fx('shiprocket-unknown.json') },
    );
    for (let i = 0; i < 20; i++) await svc.lookup(`1000000000${String(i).padStart(2, '0')}`, 'ip');
    const err = await svc.lookup('10000000099', 'ip').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    await expect(svc.lookup('10000000098', 'other')).resolves.toBeNull();
  });

  it('opens the breaker after 5 failures, answers 503 and stops calling', async () => {
    const { svc } = make();
    const f = mockFetch(() => ({ status: 503 }));
    for (let i = 0; i < 5; i++) {
      await svc.lookup(`2000000000${i}`, `ip${i}`).catch(() => undefined);
    }
    const calls = f.mock.calls.length;
    const err = await svc.lookup('20000000009', 'ipx').catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(503);
    expect(f.mock.calls.length).toBe(calls); // both breakers already open
  });

  it('raises ONE medium issue per courier when the shape changes', async () => {
    const { svc, raise } = make();
    mockFetch(() => ({ body: { unexpected: true } }));
    await svc.lookup(AWB, 'a').catch(() => undefined);
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'external-tracking-shape:delhivery',
        severity: 'MEDIUM',
      }),
    );
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'external-tracking-shape:shiprocket' }),
    );
  });

  it('one courier down and the other not found is 503, never a false "not found"', async () => {
    const { svc } = make();
    mockFetch((u) =>
      u.includes('delhivery') ? { status: 500 } : { body: fx('shiprocket-unknown.json') },
    );
    const err = await svc.lookup(AWB, 'ip').catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(503);
  });
});

describe('PublicTrackingLookupService', () => {
  const own = { awbNumber: 'OWN1', timeline: [] } as unknown as PublicTrackingResponse;

  it('our own AWB uses the old path and never touches the external service', async () => {
    const external = { lookup: jest.fn() };
    const svc = new PublicTrackingLookupService(
      { findByAwb: async () => own } as never,
      external as never,
    );
    const r = await svc.lookup('OWN1', 'ip');
    expect(r.source).toBe('SKYDROP');
    expect(external.lookup).not.toHaveBeenCalled();
  });

  it('falls through only on a not-found, and rethrows the generic 404 on a total miss', async () => {
    const nf = new NotFoundException({ code: 'TRACKING_NOT_FOUND' });
    const external = { lookup: jest.fn(async () => null) };
    const svc = new PublicTrackingLookupService(
      {
        findByAwb: async () => {
          throw nf;
        },
      } as never,
      external as never,
    );
    await expect(svc.lookup('NOPE123', 'ip')).rejects.toBe(nf);
    expect(external.lookup).toHaveBeenCalledWith('NOPE123', 'ip');
  });
});
