import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** How long a looked-up limit is trusted before re-reading. */
const TTL_MS = 60_000;

interface Entry {
  readonly limit: number | null;
  readonly readAt: number;
}

/**
 * A rate limit that lives in `system_settings`, without paying for it.
 *
 * ── THE OBJECTION THIS EXISTS TO ANSWER ──────────────────────────────
 * Making a limit dynamic naively means a database read on EVERY request
 * to the throttled route — including the flood the limit exists to
 * stop, so the read becomes the amplification and the limiter is the
 * attack surface. That is why the public tracking limit was a constant.
 *
 * A 60-second cache removes it: at most one read per minute per API
 * instance regardless of traffic, and an operator's change takes effect
 * within a minute rather than a redeploy. The window is deliberately
 * short enough that the setting is genuinely operational and long
 * enough that a flood cannot reach the database through it.
 *
 * ── FAILING OPEN IS NOT AN OPTION HERE ───────────────────────────────
 * Every failure — missing row, wrong type, unreadable database, a value
 * that is not a positive integer — returns null, and the caller keeps
 * the static limit from `@Throttle()`. A settings problem must never
 * be able to REMOVE a rate limit on an endpoint open to the internet.
 * A stale-but-sane number beats an unbounded one.
 */
@Injectable()
export class ThrottleLimitCacheService {
  private readonly logger = new Logger(ThrottleLimitCacheService.name);
  private readonly cache = new Map<string, Entry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The configured limit, or null to mean "use the static one".
   *
   * Never throws: a throttler guard that can throw on a settings read
   * turns a database blip into a 500 on every request to the route.
   */
  async limitFor(settingKey: string): Promise<number | null> {
    const now = Date.now();
    const hit = this.cache.get(settingKey);
    if (hit !== undefined && now - hit.readAt < TTL_MS) return hit.limit;

    let limit: number | null = null;
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: settingKey },
        select: { valueInt: true },
      });
      const raw = row?.valueInt ?? null;
      // A zero or negative limit would block every request to a public
      // endpoint, which reads as an outage rather than as a setting
      // somebody mistyped. Refuse it and keep the static number.
      limit = raw !== null && Number.isInteger(raw) && raw > 0 ? raw : null;
      if (raw !== null && limit === null) {
        this.logger.warn(
          { settingKey, value: raw },
          'Rate-limit setting is not a positive integer — keeping the static limit',
        );
      }
    } catch (err) {
      this.logger.warn(
        { settingKey, err: err instanceof Error ? err.message : String(err) },
        'Could not read the rate-limit setting — keeping the static limit',
      );
      limit = null;
    }

    // Cached either way, INCLUDING the null: a database that is down
    // should be asked once a minute, not once per request.
    this.cache.set(settingKey, { limit, readAt: now });
    return limit;
  }

  /** Test seam — drops the memo so a change is observed immediately. */
  invalidate(): void {
    this.cache.clear();
  }
}
