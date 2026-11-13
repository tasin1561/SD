import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { billedFromRealUsd } from '../assistant-pricing';
import { AssistantBudgetService } from './assistant-budget.service';
import { AssistantStoreService } from './assistant-store.service';

/** The shares of the monthly budget that tell the admins something. */
export const ALERT_THRESHOLDS = [80, 100] as const;

/** `2026-11` — the UTC calendar month an alert belongs to. */
export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * "The assistant has used 80% of this month's budget" — told ONCE per
 * calendar month, and once more at 100% when it switches to help-links only.
 *
 * ── WHO IS TOLD, AND HOW ─────────────────────────────────────────────
 * Through the system-issue board (NOTIF-16), not a mailer of our own: an
 * issue of kind OTHER is addressed to `system.settings.view`, the key that
 * opens /system-issues and the settings page where the budget is raised.
 * 80% is HIGH (in-app), 100% is CRITICAL (in-app and e-mail).
 *
 * ── ONCE, BY CONSTRUCTION ────────────────────────────────────────────
 * The dedupe is a unique key (month, threshold) that the first request
 * INSERTs with `ON CONFLICT DO NOTHING`. Every other request — concurrent,
 * replayed, or after a restart — hits the constraint and sends nothing. A
 * read-then-write ("has this been sent?") would let two requests that
 * cross the line together both say no.
 *
 * ── NEVER IN THE WAY ─────────────────────────────────────────────────
 * Runs after the usage row is written and is not awaited by the answer. Any
 * failure is logged and swallowed. In-flight checks are tracked so the e2e
 * reset can drain them (NOTIF-19).
 */
@Injectable()
export class AssistantBudgetAlertService implements OnModuleDestroy {
  private readonly log = new Logger(AssistantBudgetAlertService.name);
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly budget: AssistantBudgetService,
    private readonly store: AssistantStoreService,
    private readonly issues: SystemIssueService,
  ) {}

  /** Fire and forget. Never throws, never delays the caller. */
  afterUsage(now: Date = new Date()): void {
    const p = this.check(now)
      .catch((e: unknown) => {
        this.log.error(
          `assistant budget alert check failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        this.inFlight.delete(p);
      });
    this.inFlight.add(p);
  }

  async drainInFlight(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drainInFlight();
  }

  /** Public for the e2e, which calls it directly to race it against itself. */
  async check(now: Date = new Date()): Promise<void> {
    const budget = await this.budget.monthlyBudgetUsd();
    if (!(budget > 0)) return;
    // The SAME spend the cap reads — never summed anywhere else.
    const spent = await this.budget.monthlySpendUsd(now);
    const crossed = ALERT_THRESHOLDS.filter((t) => spent.mul(100).greaterThanOrEqualTo(budget * t));
    if (crossed.length === 0) return;

    const month = monthKey(now);
    const won: number[] = [];
    // Stored as shown: billed figures (2.5x real), like every AI cost.
    const shownSpent = billedFromRealUsd(spent);
    const shownBudget = billedFromRealUsd(budget);
    for (const t of crossed) {
      if (await this.store.claimBudgetAlert(month, t, shownSpent, shownBudget.toNumber())) {
        won.push(t);
      }
    }
    if (won.length === 0) return;

    // Jumping straight past 80% to 100% is ONE message, the louder one.
    const top = Math.max(...won);
    const raised = await this.issues.raise({
      kind: SystemIssueKind.OTHER,
      severity: top >= 100 ? SystemIssueSeverity.CRITICAL : SystemIssueSeverity.HIGH,
      title:
        top >= 100
          ? 'The AI assistant has used all of this month’s budget'
          : `The AI assistant has used ${top}% of this month’s budget`,
      detail:
        top >= 100
          ? `Spent $${shownSpent.toFixed(2)} of the $${shownBudget.toFixed(2)} monthly budget (${month}). The assistant now answers with help links only until next month. To keep it answering, raise the assistant's monthly budget in System settings.`
          : `Spent $${shownSpent.toFixed(2)} of the $${shownBudget.toFixed(2)} monthly budget (${month}). At 100% the assistant switches to help links only for the rest of the month. To change the cap, edit the assistant's monthly budget in System settings.`,
      source: 'assistant-budget',
      dedupeKey: `assistant-budget:${month}:${top}`,
    });
    if (raised === null) {
      // Nothing was recorded or sent: give the claims back so a later answer retries.
      for (const t of won) await this.store.releaseBudgetAlert(month, t);
    }
  }
}
