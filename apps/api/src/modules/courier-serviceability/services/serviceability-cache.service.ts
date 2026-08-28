import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export interface CachedServiceability {
  readonly serviceable: boolean;
  readonly reason: string | null;
  /** False when this answer came from cache rather than the courier. */
  readonly fresh: boolean;
}

/**
 * Whether a pincode is deliverable, remembered.
 *
 * The underlying check is a live Delhivery call. Asking it on every
 * order create would put one API call on the hot path of the thing
 * sellers do most, against an account whose WAF answers 403 — for our
 * whole egress IP — when a budget runs out. That is not a trade worth
 * making for an answer that changes maybe twice a year.
 *
 * So it is cached for a day. The first order to a new pin pays for the
 * lookup and every order after it is free. A pin that becomes
 * serviceable is picked up within 24 hours, and one that STOPS being
 * serviceable is caught the same day — plus, for anything already in
 * flight, by the AWB rejection that CUR-5 has always relied on.
 *
 * Failures are cached too, briefly. A courier outage would otherwise
 * turn every order create into a slow retry of the same failing call.
 */
@Injectable()
export class ServiceabilityCacheService {
  private readonly logger = new Logger(ServiceabilityCacheService.name);

  /** A day. Serviceability is a property of the courier's network. */
  private static readonly TTL_SECONDS = 24 * 60 * 60;
  /** Two minutes. Long enough to shield a wobble, short enough to recover. */
  private static readonly ERROR_TTL_SECONDS = 120;

  constructor(private readonly redis: RedisService) {}

  private key(pincode: string, paymentMode: string): string {
    return `skydrop:serviceable:${paymentMode}:${pincode}`;
  }

  /**
   * Ask, remembering the answer.
   *
   * `compute` is only called on a miss. It may throw — a courier that
   * will not answer is not a pin that is unserviceable, and the caller
   * decides what to do with that. What this will NOT do is let the
   * failure through uncached and unbounded.
   */
  async get(
    pincode: string,
    paymentMode: string,
    compute: () => Promise<{ ok: boolean; reason: string | null }>,
  ): Promise<CachedServiceability | null> {
    const key = this.key(pincode, paymentMode);

    try {
      const hit = await this.redis.client.get(key);
      if (hit !== null) {
        const parsed = JSON.parse(hit) as { serviceable: boolean; reason: string | null };
        return { ...parsed, fresh: false };
      }
    } catch (err) {
      // A cache that cannot be read is not a reason to refuse an order.
      this.logger.warn(
        { pincode, err: err instanceof Error ? err.message : String(err) },
        'Serviceability cache unreadable; asking the courier',
      );
    }

    let answer: { ok: boolean; reason: string | null };
    try {
      answer = await compute();
    } catch (err) {
      // Cached briefly so an outage does not turn every order create
      // into a slow retry of the same failing call. Returns null: the
      // caller learns nothing, which is the truth.
      this.logger.warn(
        { pincode, err: err instanceof Error ? err.message : String(err) },
        'Could not check serviceability',
      );
      await this.remember(
        key,
        { serviceable: true, reason: null },
        ServiceabilityCacheService.ERROR_TTL_SECONDS,
      );
      return null;
    }

    const value = { serviceable: answer.ok, reason: answer.reason };
    await this.remember(key, value, ServiceabilityCacheService.TTL_SECONDS);
    return { ...value, fresh: true };
  }

  private async remember(
    key: string,
    value: { serviceable: boolean; reason: string | null },
    ttl: number,
  ): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch {
      // Not being able to remember is not worth failing an order over.
    }
  }
}
