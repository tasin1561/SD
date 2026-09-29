/**
 * Clear the LOCAL login rate-limit counters before a take.
 *
 * Seller sign-in is throttled at 5 attempts per 15 minutes per email+IP
 * (`@Throttle` on `SellerAuthController`), which is right in production
 * and is the binding constraint on making tutorials: a video costs THREE
 * sign-ins — two `--check` passes and the take — so the fourth video in
 * any quarter of an hour is refused at the login screen.
 *
 * Worse, the counter is not a sliding window of successes. A REFUSED
 * attempt writes a `blocked` key with its own fresh TTL, so retrying
 * because you think the window has passed pushes the window out again —
 * observed here at 839 seconds remaining after several retries, which is
 * longer than the original lockout.
 *
 * `@nest-lab/throttler-storage-redis` keeps these as `{<hash>:default}:hits`
 * and `:blocked` in Redis, so clearing them is deleting a local counter
 * and nothing else: no product code changes, no guard is weakened, and
 * the throttle is exactly as it was for the next request. It is a
 * DEVELOPMENT convenience in the same spirit as `DEV_MOCK_SPACES`.
 *
 * Refuses a REDIS_URL that is not local, on the same reasoning as the
 * seed's `assertLocal` — clearing a rate limit on a real deployment
 * would remove the brute-force protection on real seller accounts.
 *
 *   node scripts/tutorials/lib/clear-login-throttle.mjs
 */
import { Redis } from './deps.mjs';

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

function assertLocal(url) {
  const host = new globalThis.URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'redis';
  if (!local) {
    throw new Error(
      `Refusing to clear rate-limit counters on "${host}". This is a local recording ` +
        `convenience; on a real deployment those counters are the brute-force protection ` +
        `on seller accounts.`,
    );
  }
}

export async function clearLoginThrottle({ log = console.log } = {}) {
  assertLocal(URL);
  const client = new Redis(URL, { maxRetriesPerRequest: null, lazyConnect: true });
  await client.connect();
  try {
    // The throttler's keys are the only ones in this database that are
    // not BullMQ's, and they are hash-named, so they are found by
    // exclusion rather than by a pattern we would have to keep in step
    // with the library's key format.
    const keys = [];
    let cursor = '0';
    do {
      const [next, batch] = await client.scan(cursor, 'COUNT', 500);
      cursor = next;
      for (const k of batch) if (!k.startsWith('bull:')) keys.push(k);
    } while (cursor !== '0');
    if (keys.length > 0) await client.del(...keys);
    log(`  · cleared ${keys.length} rate-limit counter(s)`);
    return keys.length;
  } finally {
    client.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await clearLoginThrottle();
}
