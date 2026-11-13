import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AssistantAudience } from '@skydrop/db';
import { SystemSettingsService } from '../../system-settings/services/system-settings.service';
import { realFromBilledUsd } from '../assistant-pricing';
import type { CallerScope } from '../assistant.types';
import { AssistantStoreService } from './assistant-store.service';

export type BudgetVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'DISABLED' | 'RESTING_BUDGET' | 'RESTING_DAILY' };

export const DEFAULT_MONTHLY_BUDGET_USD = 80;
export const DEFAULT_DAILY_MESSAGES = 60;
export const DEFAULT_MONITOR_BUDGET_USD = 20;
export const DEFAULT_PUBLIC_BUDGET_USD = 10;

/**
 * "Should this request call the model at all?" — read INSIDE the request,
 * from the settings and the recorded usage, every time. Nothing is
 * cached: a raised budget or a flipped kill switch takes effect on the
 * next message.
 *
 * The cost it sums is the cost WE computed from the usage the API
 * reported for each response (`assistant_usage`), at the rate card that
 * response's prompt size selected. The guard is "stop BEFORE the first
 * request that would start past the cap" — one in-flight answer can
 * overshoot by its own cost, which at these prices is a fraction of a
 * cent against an $80 cap.
 */
@Injectable()
export class AssistantBudgetService {
  private readonly log = new Logger(AssistantBudgetService.name);

  constructor(
    private readonly settings: SystemSettingsService,
    private readonly store: AssistantStoreService,
  ) {}

  async check(scope: CallerScope, now: Date = new Date()): Promise<BudgetVerdict> {
    if (!(await this.enabled())) return { ok: false, code: 'DISABLED' };
    // The PUBLIC line: its own switch (OFF unless an admin turned it on) and
    // its own monthly cap. No per-person daily count: a visitor has no
    // identity, and the turn cap, the per-IP / per-AWB throttles and this cap
    // bound what a tracking page can cost.
    if (scope.audience === 'PUBLIC') {
      if (!(await this.publicEnabled())) return { ok: false, code: 'DISABLED' };
      return (await this.publicMonthlyOk(now))
        ? { ok: true }
        : { ok: false, code: 'RESTING_BUDGET' };
    }
    if (!(await this.portalEnabled(scope.audience))) return { ok: false, code: 'DISABLED' };

    const dailyCap = await this.number('assistant.daily_messages_per_user', DEFAULT_DAILY_MESSAGES);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if ((await this.store.questionsSince(scope, dayStart)) >= dailyCap) {
      return { ok: false, code: 'RESTING_DAILY' };
    }

    const budget = await this.monthlyBudgetUsd();
    const spent = await this.monthlySpendUsd(now);
    if (spent.greaterThanOrEqualTo(budget)) return { ok: false, code: 'RESTING_BUDGET' };

    return { ok: true };
  }

  /** The kill switch alone — for the mid-answer re-check, which must not re-count questions. */
  async enabled(): Promise<boolean> {
    try {
      const v = (await this.settings.getByKey('assistant.enabled')).value;
      return v !== false;
    } catch {
      return true;
    }
  }

  /**
   * The per-console switch (`assistant.portal_<staff|seller|store|associate>_enabled`),
   * read on every request like the kill switch, so flipping it needs no deploy.
   */
  portalEnabled(audience: AssistantAudience): Promise<boolean> {
    return this.flag(`assistant.portal_${audience.toLowerCase()}_enabled`, true);
  }

  /** `assistant.attachments_enabled`: off refuses NEW uploads only. */
  attachmentsEnabled(): Promise<boolean> {
    return this.flag('assistant.attachments_enabled', true);
  }

  private async flag(key: string, fallback: boolean): Promise<boolean> {
    try {
      const v = (await this.settings.getByKey(key)).value;
      return typeof v === 'boolean' ? v : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Only the monthly cap, for a tool round inside one answer. `audience`
   * picks the line: PUBLIC checks the public helper's own cap, everyone else
   * the console cap.
   */
  async monthlyOk(now: Date = new Date(), audience?: AssistantAudience): Promise<boolean> {
    if (audience === 'PUBLIC') return this.publicMonthlyOk(now);
    return (await this.monthlySpendUsd(now)).lessThan(await this.monthlyBudgetUsd());
  }

  // ── the public parcel helper's line ────────────────────────────────
  // Same shape as the monitor's, with its own switch and cap. These are the
  // ONLY readers of the PUBLIC line of `assistant_usage` for a cap decision.

  /** `assistant.public_enabled`: OFF unless an admin turned it on. */
  publicEnabled(): Promise<boolean> {
    return this.flag('assistant.public_enabled', false);
  }

  /** The public helper's monthly cap in REAL USD (`assistant.public_monthly_budget_usd`, default $10). */
  publicMonthlyBudgetUsd(): Promise<number> {
    return this.number('assistant.public_monthly_budget_usd', DEFAULT_PUBLIC_BUDGET_USD);
  }

  /** What the public helper has spent this UTC month, in REAL USD (stored / 2.5). */
  async publicMonthlySpendUsd(now: Date = new Date()): Promise<Prisma.Decimal> {
    const billed = await this.store.publicCostSince(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    );
    return realFromBilledUsd(billed);
  }

  async publicMonthlyOk(now: Date = new Date()): Promise<boolean> {
    return (await this.publicMonthlySpendUsd(now)).lessThan(await this.publicMonthlyBudgetUsd());
  }

  /** Would a visitor's question be answered right now? (the page's "show the helper" question) */
  async publicAvailable(now: Date = new Date()): Promise<boolean> {
    return (
      (await this.enabled()) && (await this.publicEnabled()) && (await this.publicMonthlyOk(now))
    );
  }

  /**
   * THE one definition of "what has the assistant spent this UTC month", in
   * REAL Anthropic dollars. `assistant_usage.cost_usd` holds the billed
   * figure (2.5x real, owner 2026-11-13) and the caps are real money, so this
   * converts back. The cap above and the 80% / 100% alert both read it, so
   * the warning can never disagree with the cap. Nothing else sums
   * `assistant_usage.cost_usd` for the month.
   */
  async monthlySpendUsd(now: Date = new Date()): Promise<Prisma.Decimal> {
    const billed = await this.store.costSince(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    );
    return realFromBilledUsd(billed);
  }

  /** The monthly cap in USD (`assistant.monthly_budget_usd`, default $80). */
  monthlyBudgetUsd(): Promise<number> {
    return this.number('assistant.monthly_budget_usd', DEFAULT_MONTHLY_BUDGET_USD);
  }

  // ── the overnight monitor's line ───────────────────────────────────
  // Same shape as the assistant's, with its own cap. These three are the
  // ONLY readers of `assistant_monitor_usage.cost_usd` for a cap decision.

  /** `assistant.monitor_enabled`: OFF unless an admin turned it on. */
  monitorEnabled(): Promise<boolean> {
    return this.flag('assistant.monitor_enabled', false);
  }

  /** The monitor's monthly cap in REAL USD (`assistant.monitor_monthly_budget_usd`, default $20). */
  monitorMonthlyBudgetUsd(): Promise<number> {
    return this.number('assistant.monitor_monthly_budget_usd', DEFAULT_MONITOR_BUDGET_USD);
  }

  /** What the monitor has spent this UTC month, in REAL USD (stored / 2.5). */
  async monitorMonthlySpendUsd(now: Date = new Date()): Promise<Prisma.Decimal> {
    const billed = await this.store.monitorCostSince(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    );
    return realFromBilledUsd(billed);
  }

  /** Real USD the monitor may still spend this month (never negative). */
  async monitorRemainingUsd(now: Date = new Date()): Promise<Prisma.Decimal> {
    const left = new Prisma.Decimal(await this.monitorMonthlyBudgetUsd()).sub(
      await this.monitorMonthlySpendUsd(now),
    );
    return left.isNegative() ? new Prisma.Decimal(0) : left;
  }

  private async number(key: string, fallback: number): Promise<number> {
    try {
      const n = Number((await this.settings.getByKey(key)).value);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    } catch {
      this.log.warn(`setting ${key} unreadable; using ${fallback}`);
      return fallback;
    }
  }
}
