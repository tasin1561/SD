import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  StockPickAllocationService,
  type AppliedAllocation,
} from '../inventory-stock/services/stock-pick-allocation.service';

const RETRY_MAX_SETTING_KEY = 'ops.pick_allocation_retry_max';
const RETRY_BACKOFF_SETTING_KEY = 'ops.pick_allocation_retry_backoff_ms';
/** Seeded defaults (commit 2) when the settings rows are absent. */
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_BACKOFF_MS: readonly number[] = [100, 250, 500];

/** The M5 409 the WMS-3 wrapper retries (and ONLY this one). */
const M5_CONFLICT_CODE = 'PICK_ALLOCATION_CONFLICT';

/**
 * Module 8 — WMS-3 pick-allocation resilience layer over the M5
 * boundary. `StockPickAllocationService.allocateAndPopulate` already
 * has its OWN inner version-CAS retry (≤3 re-plans) and surfaces a
 * terminal 409 `PICK_ALLOCATION_CONFLICT` only on PERSISTENT contention.
 * This wrapper adds the M8-side OUTER retry with backoff so a transient
 * contention burst at pick-task generation doesn't immediately escalate
 * the parcel to manual handling — it re-attempts the whole M5 call up to
 * `ops.pick_allocation_retry_max` times (seeded 3), sleeping
 * `ops.pick_allocation_retry_backoff_ms` ([100,250,500]) between
 * attempts, then surfaces a terminal `PICK_ALLOCATION_RETRY_EXHAUSTED`
 * for commit 6 to route to PENDING_MANUAL_PLACEMENT (WMS-4).
 *
 * It is a pure SAGA-discipline pass-through: M5 owns its own
 * version-CAS tx (INV-1/INV-6), this service NEVER wraps it in a tx and
 * takes no tx param (the documented M5↔M8 boundary rule). Only the
 * typed 409 is retryable; deterministic failures (RESERVATION_NOT_FOUND
 * 404, RESERVATION_NOT_ACTIVE 409) and the legitimate
 * "nothing pickable yet" result (M5 returns strategy NONE / allocatedQty
 * 0 — NOT a throw; stock simply hasn't arrived) pass straight through
 * untouched: retrying conjures neither a row nor stock.
 */
@Injectable()
export class PickAllocationService {
  private readonly logger = new Logger(PickAllocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alloc: StockPickAllocationService,
  ) {}

  /**
   * Run M5 `allocateAndPopulate` with the WMS-3 outer retry/backoff.
   * Returns the M5 `AppliedAllocation` verbatim (including a legitimate
   * shortfall / strategy-NONE result). Throws
   * `PICK_ALLOCATION_RETRY_EXHAUSTED` (409) only when M5's terminal
   * `PICK_ALLOCATION_CONFLICT` persists across every attempt.
   */
  async allocateForPick(
    reservationId: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
  ): Promise<AppliedAllocation> {
    const [maxAttempts, backoff] = await Promise.all([this.retryMax(), this.retryBackoffMs()]);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.alloc.allocateAndPopulate(reservationId, actor);
      } catch (err) {
        if (!this.isRetryableConflict(err)) throw err; // deterministic — out
        lastErr = err;
        if (attempt < maxAttempts) {
          // Clamp to the last backoff entry when there are more attempts
          // than configured delays.
          const idx = Math.min(attempt - 1, backoff.length - 1);
          const waitMs = backoff[idx] ?? 0;
          this.logger.warn(
            { reservationId, attempt, maxAttempts, waitMs },
            'M5 PICK_ALLOCATION_CONFLICT; backing off then re-attempting',
          );
          await this.delay(waitMs);
        }
      }
    }

    throw new ConflictException({
      code: 'PICK_ALLOCATION_RETRY_EXHAUSTED',
      message: `Pick allocation still contended after ${maxAttempts} attempt(s); route to manual placement`,
      cause: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
  }

  // ── internal ──────────────────────────────────────────────────────

  /** True only for M5's terminal `PICK_ALLOCATION_CONFLICT` 409 — the
   *  one signal that more attempts might clear (transient contention). */
  private isRetryableConflict(err: unknown): boolean {
    if (!(err instanceof ConflictException)) return false;
    const resp = err.getResponse();
    return (
      typeof resp === 'object' &&
      resp !== null &&
      (resp as { code?: unknown }).code === M5_CONFLICT_CODE
    );
  }

  private async retryMax(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: RETRY_MAX_SETTING_KEY },
      select: { valueInt: true },
    });
    const v = row?.valueInt;
    return typeof v === 'number' && v >= 1 ? v : DEFAULT_RETRY_MAX;
  }

  private async retryBackoffMs(): Promise<number[]> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: RETRY_BACKOFF_SETTING_KEY },
      select: { valueJson: true },
    });
    const raw = row?.valueJson;
    if (Array.isArray(raw) && raw.length > 0 && raw.every((n) => typeof n === 'number' && n >= 0)) {
      return raw as number[];
    }
    return [...DEFAULT_BACKOFF_MS];
  }

  /** Indirection so unit tests can stub the wait without real timers. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
