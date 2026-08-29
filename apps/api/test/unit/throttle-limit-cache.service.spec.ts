import { ThrottleLimitCacheService } from '../../src/common/throttler/throttle-limit-cache.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const KEY = 'tracking.public_lookup_rate_limit_per_min';

function make(opts: { value?: number | null; throws?: boolean } = {}) {
  const findUnique = jest.fn(async () => {
    if (opts.throws === true) throw new Error('database unreachable');
    return opts.value === undefined ? { valueInt: 30 } : { valueInt: opts.value };
  });
  const svc = new ThrottleLimitCacheService({
    client: { systemSetting: { findUnique } },
  } as unknown as PrismaService);
  return { svc, findUnique };
}

/**
 * A dynamic rate limit is only worth having if it cannot itself be
 * attacked. Reading the setting per request would mean the flood the
 * limit exists to stop is a flood against the database, and the limiter
 * becomes the amplification — which is why this was a constant.
 */
describe('ThrottleLimitCacheService', () => {
  it('reads the setting ONCE and serves the rest from memory', async () => {
    const { svc, findUnique } = make({ value: 45 });

    for (let i = 0; i < 50; i += 1) expect(await svc.limitFor(KEY)).toBe(45);

    // Fifty requests, one query. That ratio is the whole design.
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static limit when the row is missing', async () => {
    const { svc } = make({ value: null });
    // null means "the caller keeps @Throttle's number" — never "no limit".
    expect(await svc.limitFor(KEY)).toBeNull();
  });

  it('refuses a non-positive limit rather than blocking every request', async () => {
    for (const bad of [0, -5]) {
      const { svc } = make({ value: bad });
      // A zero would reject every request to a public endpoint, which
      // reads as an outage rather than as a setting somebody mistyped.
      expect(await svc.limitFor(KEY)).toBeNull();
    }
  });

  it('refuses a non-integer limit', async () => {
    const { svc } = make({ value: 12.5 });
    expect(await svc.limitFor(KEY)).toBeNull();
  });

  it('a database failure keeps the static limit and does NOT throw', async () => {
    const { svc } = make({ throws: true });
    // A guard that throws on a settings read turns a database blip into
    // a 500 on every request to the route.
    await expect(svc.limitFor(KEY)).resolves.toBeNull();
  });

  it('caches the failure too, so an outage is asked once a minute not once a request', async () => {
    const { svc, findUnique } = make({ throws: true });

    for (let i = 0; i < 20; i += 1) await svc.limitFor(KEY);

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('re-reads after invalidation, so an operator change is observable', async () => {
    const { svc, findUnique } = make({ value: 45 });
    expect(await svc.limitFor(KEY)).toBe(45);
    svc.invalidate();
    expect(await svc.limitFor(KEY)).toBe(45);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
