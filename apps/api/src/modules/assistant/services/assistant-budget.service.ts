import { Injectable, Logger } from '@nestjs/common';
import type { AssistantAudience, Prisma } from '@skydrop/db';
import { SystemSettingsService } from '../../system-settings/services/system-settings.service';
import { realFromBilledUsd } from '../assistant-pricing';
import type { CallerScope } from '../assistant.types';
import { AssistantStoreService } from './assistant-store.service';

export type BudgetVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'DISABLED' | 'RESTING_BUDGET' | 'RESTING_DAILY' };

export const DEFAULT_MONTHLY_BUDGET_USD = 80;
export const DEFAULT_DAILY_MESSAGES = 60;

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

  /** Only the monthly cap, for a tool round inside one answer. */
  async monthlyOk(now: Date = new Date()): Promise<boolean> {
    return (await this.monthlySpendUsd(now)).lessThan(await this.monthlyBudgetUsd());
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
