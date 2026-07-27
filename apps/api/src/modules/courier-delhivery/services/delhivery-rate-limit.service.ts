import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../infrastructure/redis/redis.service';

/**
 * The documented Delhivery budgets, in requests per 5 minutes PER IP.
 * Source: docs/delhivery-integration.md §2 (captured from the developer
 * portal 2026-07-27).
 *
 * These are enforced by AWS WAF and answer **403**, not 429 — and the
 * block applies to the whole IP, so a runaway loop in a background job
 * takes LIVE traffic down with it. On a production-only integration
 * (no sandbox) that is the difference between a bad test and an outage.
 *
 * We budget to 80% of each documented limit so that a burst still leaves
 * headroom for the operational calls we cannot defer (a customer pressing
 * "track", a dispatch going out).
 */
export type DelhiveryEndpoint =
  | 'serviceability'
  | 'serviceability_heavy'
  | 'waybill_bulk'
  | 'waybill_single'
  | 'create'
  | 'edit'
  | 'tracking'
  | 'label'
  | 'ewaybill'
  | 'cost'
  | 'tat'
  | 'pickup'
  | 'warehouse'
  | 'ndr'
  | 'document';

const WINDOW_SECONDS = 300;

/** Documented limit per 5-minute window; null = undocumented ("NA"). */
const DOCUMENTED_LIMIT: Readonly<Record<DelhiveryEndpoint, number | null>> = {
  serviceability: 4_500,
  serviceability_heavy: 3_000,
  // FIVE. Not a typo — this is why waybills must be pooled in advance
  // rather than fetched per shipment.
  waybill_bulk: 5,
  waybill_single: 750,
  create: 20_000,
  edit: 12_200,
  tracking: 750,
  label: 3_000,
  ewaybill: 250,
  cost: null,
  tat: null,
  pickup: null,
  warehouse: null,
  ndr: null,
  document: null,
  // An undocumented limit is not an absent one; see UNDOCUMENTED_FALLBACK.
};

/** Applied where Delhivery documents "NA" — conservative, not unlimited. */
const UNDOCUMENTED_FALLBACK = 600;
const SAFETY_FACTOR = 0.8;

export class DelhiveryRateLimitError extends Error {
  constructor(
    readonly endpoint: DelhiveryEndpoint,
    readonly budget: number,
    readonly retryAfterSeconds: number,
  ) {
    super(
      `Delhivery ${endpoint} rate budget exhausted (${budget}/5min); retry in ${retryAfterSeconds}s`,
    );
    this.name = 'DelhiveryRateLimitError';
  }
}

/**
 * Client-side rate budget for the Delhivery API.
 *
 * A fixed window in Redis, keyed per endpoint. Fixed rather than sliding
 * on purpose: it is cheap, it is shared across every API instance (the
 * WAF counts our whole egress IP, not per process), and the 20% headroom
 * absorbs the boundary burst that a fixed window allows.
 *
 * Fails OPEN. If Redis is unavailable we let the call through rather than
 * stopping dispatches — Delhivery's own WAF is the real backstop, and a
 * Redis outage must not become a shipping outage.
 */
@Injectable()
export class DelhiveryRateLimitService {
  private readonly logger = new Logger(DelhiveryRateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  budgetFor(endpoint: DelhiveryEndpoint): number {
    const documented = DOCUMENTED_LIMIT[endpoint] ?? UNDOCUMENTED_FALLBACK;
    return Math.max(1, Math.floor(documented * SAFETY_FACTOR));
  }

  /**
   * Consume one unit of budget. Throws `DelhiveryRateLimitError` when the
   * window is exhausted — callers treat it as retryable, never as a
   * shipment failure.
   */
  async consume(endpoint: DelhiveryEndpoint): Promise<void> {
    const budget = this.budgetFor(endpoint);
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `dlv:rl:${endpoint}:${window}`;

    let used: number;
    try {
      const client = this.redis.client;
      used = await client.incr(key);
      if (used === 1) await client.expire(key, WINDOW_SECONDS + 10);
    } catch (err) {
      // Fail OPEN — see class doc.
      this.logger.warn(
        { endpoint, err: (err as Error).message },
        'Delhivery rate-limit check failed; allowing the call through',
      );
      return;
    }

    if (used > budget) {
      const retryAfter = (window + 1) * WINDOW_SECONDS - Math.floor(Date.now() / 1000);
      this.logger.warn(
        { endpoint, used, budget, retryAfter },
        'Delhivery rate budget exhausted — refusing the call locally rather than earning a WAF 403',
      );
      throw new DelhiveryRateLimitError(endpoint, budget, Math.max(1, retryAfter));
    }
  }

  /** Remaining budget in the current window (observability / admin). */
  async remaining(endpoint: DelhiveryEndpoint): Promise<number> {
    const budget = this.budgetFor(endpoint);
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    try {
      const raw = await this.redis.client.get(`dlv:rl:${endpoint}:${window}`);
      return Math.max(0, budget - Number(raw ?? 0));
    } catch {
      return budget;
    }
  }
}
