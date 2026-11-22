import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import type {
  ExternalCourierCode,
  PublicTrackingResponse,
} from '../dto/public-tracking.response.dto';
import {
  courierTryOrder,
  ExternalShapeError,
  isPlausibleAwb,
  mapDelhivery,
  mapShiprocket,
  type MapResult,
} from './external-tracking.mappers';

/** Tunables, exported so the spec pins the numbers the owner was told. */
export const EXTERNAL_TRACKING_LIMITS = {
  timeoutMs: 8_000,
  cacheFoundSec: 600,
  cacheMissSec: 120,
  perIpPerMinute: 20,
  perIpPerDay: 200,
  /** Backstop for callers who forge the client-IP header. */
  globalPerMinute: 300,
  breakerFailures: 5,
  breakerOpenSec: 300,
} as const;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

type Cached = { readonly nf: true } | { readonly nf: false; readonly data: PublicTrackingResponse };

type CourierOutcome =
  | { readonly kind: 'found'; readonly view: PublicTrackingResponse }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'down' };

/**
 * Owner decision 2026-11-22: track.skydrop.global answers for ANY Delhivery
 * or Shiprocket AWB, including ones we hold no record of, by reading the
 * courier's own PUBLIC tracking endpoint. UNOFFICIAL: it can change shape or
 * start refusing us at any time, so every guard below exists to fail small:
 * a cache so a refresh storm is one upstream call, per-IP and global limits,
 * a per-courier circuit breaker, and ONE system issue per courier when the
 * payload stops looking like what we map.
 *
 * Used ONLY after our own shipments table said "not ours" (see
 * PublicTrackingLookupService). Never writes anything but Redis counters.
 */
@Injectable()
export class ExternalTrackingService {
  private readonly logger = new Logger(ExternalTrackingService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly issues: SystemIssueService,
    private readonly env: EnvService,
  ) {}

  /** Returns the view, or `null` when neither courier knows the AWB. */
  async lookup(awb: string, clientIp: string | null): Promise<PublicTrackingResponse | null> {
    // The e2e suite must never reach a real courier; unit specs mock fetch.
    if (this.env.isTest || !isPlausibleAwb(awb)) return null;

    const cached = await this.cacheGet(awb);
    if (cached) return cached.nf ? null : cached.data;

    await this.enforceLimits(clientIp);

    let anyDown = false;
    for (const courier of courierTryOrder(awb)) {
      const out = await this.askCourier(courier, awb);
      if (out.kind === 'found') {
        await this.cacheSet(
          awb,
          { nf: false, data: out.view },
          EXTERNAL_TRACKING_LIMITS.cacheFoundSec,
        );
        return out.view;
      }
      if (out.kind === 'down') anyDown = true;
    }
    if (anyDown) {
      // Not "not found": we could not ask somebody. Never cached.
      throw new HttpException(
        {
          code: 'COURIER_TRACKING_DOWN',
          message: "The courier's tracking is not responding, try again shortly.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.cacheSet(awb, { nf: true }, EXTERNAL_TRACKING_LIMITS.cacheMissSec);
    return null;
  }

  // ------------------------------------------------------------ one courier

  private async askCourier(courier: ExternalCourierCode, awb: string): Promise<CourierOutcome> {
    if (await this.breakerOpen(courier)) return { kind: 'down' };
    let mapped: MapResult;
    try {
      const body = await this.fetchJson(courier, awb);
      if (body === 'NOT_FOUND') {
        await this.breakerSuccess(courier);
        return { kind: 'not_found' };
      }
      mapped = courier === 'delhivery' ? mapDelhivery(body, awb) : mapShiprocket(body, awb);
    } catch (err) {
      if (err instanceof ExternalShapeError) {
        await this.shapeChanged(courier, err.message);
      } else {
        // No AWB, no body, no headers: the message of a network/HTTP error only.
        this.logger.warn(
          { courier, err: err instanceof Error ? err.message : String(err) },
          'external tracking call failed',
        );
      }
      await this.breakerFailure(courier);
      return { kind: 'down' };
    }
    await this.breakerSuccess(courier);
    if (mapped === 'NOT_FOUND') return { kind: 'not_found' };
    return { kind: 'found', view: { ...mapped, source: 'COURIER_PUBLIC', courier } };
  }

  /** `'NOT_FOUND'` for the courier's own "no such AWB"; throws for every failure. */
  private async fetchJson(courier: ExternalCourierCode, awb: string): Promise<unknown> {
    const enc = encodeURIComponent(awb);
    const url =
      courier === 'delhivery'
        ? `https://dlv-api.delhivery.com/v3/unified-tracking?wbn=${enc}`
        : `https://apiv2.shiprocket.in/v1/tracking/${enc}`;
    const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/json' };
    if (courier === 'delhivery') {
      headers['Origin'] = 'https://www.delhivery.com';
      headers['Referer'] = 'https://www.delhivery.com/';
    }
    const res = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(EXTERNAL_TRACKING_LIMITS.timeoutMs),
    });
    // Delhivery answers 400 for a malformed waybill: that is "not theirs".
    if (courier === 'delhivery' && res.status === 400) return 'NOT_FOUND';
    if (!res.ok) throw new Error(`${courier} HTTP ${res.status}`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ExternalShapeError(courier, 'response was not JSON');
    }
    return json;
  }

  // ------------------------------------------------------------ rate limits

  private async enforceLimits(clientIp: string | null): Promise<void> {
    const ip = (clientIp ?? 'unknown').slice(0, 64);
    const checks: Array<[string, number, number]> = [
      [`trk:ext:rl:m:${ip}`, EXTERNAL_TRACKING_LIMITS.perIpPerMinute, 60],
      [`trk:ext:rl:d:${ip}`, EXTERNAL_TRACKING_LIMITS.perIpPerDay, 86_400],
      ['trk:ext:rl:global', EXTERNAL_TRACKING_LIMITS.globalPerMinute, 60],
    ];
    for (const [key, limit, ttl] of checks) {
      let n: number;
      try {
        n = await this.redis.client.incr(key);
        if (n === 1) await this.redis.client.expire(key, ttl);
      } catch (err) {
        // Redis down: fail CLOSED for the external path. It is a courtesy
        // feature; an unmetered upstream call is the thing the limits prevent.
        this.logger.warn({ err: String(err) }, 'external tracking limiter unavailable');
        throw this.limited();
      }
      if (n > limit) throw this.limited();
    }
  }

  private limited(): HttpException {
    return new HttpException(
      {
        code: 'EXTERNAL_LOOKUP_LIMIT',
        message: 'Too many tracking lookups from your connection. Please wait a few minutes.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // --------------------------------------------------------------- breaker

  private async breakerOpen(courier: ExternalCourierCode): Promise<boolean> {
    try {
      return (await this.redis.client.get(`trk:ext:brk:open:${courier}`)) !== null;
    } catch {
      return false;
    }
  }

  private async breakerFailure(courier: ExternalCourierCode): Promise<void> {
    try {
      const key = `trk:ext:brk:fail:${courier}`;
      const n = await this.redis.client.incr(key);
      if (n === 1) await this.redis.client.expire(key, EXTERNAL_TRACKING_LIMITS.breakerOpenSec);
      if (n >= EXTERNAL_TRACKING_LIMITS.breakerFailures) {
        await this.redis.client.set(
          `trk:ext:brk:open:${courier}`,
          '1',
          'EX',
          EXTERNAL_TRACKING_LIMITS.breakerOpenSec,
        );
        await this.redis.client.del(key);
        this.logger.warn({ courier }, 'external tracking breaker opened');
      }
    } catch {
      /* the breaker is best-effort */
    }
  }

  private async breakerSuccess(courier: ExternalCourierCode): Promise<void> {
    try {
      await this.redis.client.del(`trk:ext:brk:fail:${courier}`);
    } catch {
      /* best-effort */
    }
  }

  // ----------------------------------------------------------------- cache

  private async cacheGet(awb: string): Promise<Cached | null> {
    try {
      const raw = await this.redis.client.get(`trk:ext:v1:${awb}`);
      return raw === null ? null : (JSON.parse(raw) as Cached);
    } catch {
      return null;
    }
  }

  private async cacheSet(awb: string, value: Cached, ttlSec: number): Promise<void> {
    try {
      await this.redis.client.set(`trk:ext:v1:${awb}`, JSON.stringify(value), 'EX', ttlSec);
    } catch {
      /* a cache that cannot be written only costs an upstream call */
    }
  }

  // ----------------------------------------------------------- shape change

  private async shapeChanged(courier: ExternalCourierCode, what: string): Promise<void> {
    this.logger.error({ courier, what }, 'external tracking payload shape changed');
    await this.issues.raise({
      kind: SystemIssueKind.INTEGRATION,
      severity: SystemIssueSeverity.MEDIUM,
      title: `${courier === 'delhivery' ? 'Delhivery' : 'Shiprocket'} public tracking changed shape`,
      detail:
        `The public tracking page's ${courier} lookup returned something the mapper does not ` +
        `understand (${what}). Customers see "tracking not responding" for AWBs we do not hold. ` +
        `Capture a fresh response and update external-tracking.mappers.ts. Our own parcels are not affected.`,
      source: ExternalTrackingService.name,
      dedupeKey: `external-tracking-shape:${courier}`,
    });
  }
}
