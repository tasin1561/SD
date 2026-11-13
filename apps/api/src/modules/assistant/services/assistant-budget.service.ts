import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@skydrop/db';
import { SystemSettingsService } from '../../system-settings/services/system-settings.service';
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

  /** Only the monthly cap, for a tool round inside one answer. */
  async monthlyOk(now: Date = new Date()): Promise<boolean> {
    return (await this.monthlySpendUsd(now)).lessThan(await this.monthlyBudgetUsd());
  }

  /**
   * THE one definition of "what has the assistant spent this UTC month".
   * The cap above and the 80% / 100% alert both read it, so the warning can
   * never disagree with the cap about how much is spent. Nothing else sums
   * `assistant_usage.cost_usd` for the month.
   */
  monthlySpendUsd(now: Date = new Date()): Promise<Prisma.Decimal> {
    return this.store.costSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
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
