import { Prisma } from '@skydrop/db';
import {
  AssistantBudgetAlertService,
  monthKey,
} from '../../src/modules/assistant/services/assistant-budget-alert.service';

/**
 * The 80% / 100% warning, with the dedupe the database provides modelled as
 * what it is: a set with an atomic add. (The real-Postgres race is
 * `assistant-budget-alert.e2e-spec.ts`.)
 */
function rig(spent: string, budget = 80) {
  const claimed = new Set<string>();
  const raised: Array<Record<string, unknown>> = [];
  const state = {
    spent: new Prisma.Decimal(spent),
    raiseResult: { id: 'i1', isNew: true } as unknown,
  };
  const budgetSvc = {
    monthlyBudgetUsd: async () => budget,
    monthlySpendUsd: async () => state.spent,
  };
  const store = {
    claimBudgetAlert: async (month: string, t: number) => {
      const k = `${month}:${t}`;
      if (claimed.has(k)) return false;
      claimed.add(k);
      return true;
    },
    releaseBudgetAlert: async (month: string, t: number) => {
      claimed.delete(`${month}:${t}`);
    },
  };
  const issues = {
    raise: async (i: Record<string, unknown>) => {
      raised.push(i);
      return state.raiseResult;
    },
  };
  const svc = new AssistantBudgetAlertService(budgetSvc as never, store as never, issues as never);
  return { svc, raised, claimed, state };
}
const NOV = new Date('2026-11-13T10:00:00Z');

describe('assistant budget alert', () => {
  it('says nothing below 80%', async () => {
    const { svc, raised } = rig('63.99');
    await svc.check(NOV);
    expect(raised).toHaveLength(0);
  });

  it('warns at exactly 80% (HIGH), once per month, however many answers follow', async () => {
    const { svc, raised } = rig('64.00');
    for (let i = 0; i < 5; i++) await svc.check(NOV);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      severity: 'HIGH',
      kind: 'OTHER',
      dedupeKey: 'assistant-budget:2026-11:80',
    });
    expect(String(raised[0]!['detail'])).toContain('$64.00 of the $80.00');
  });

  it('warns again at 100% (CRITICAL) — once — after the 80% one', async () => {
    const { svc, raised, state } = rig('65');
    await svc.check(NOV);
    state.spent = new Prisma.Decimal('80.01');
    await svc.check(NOV);
    await svc.check(NOV);
    expect(raised.map((r) => r['severity'])).toEqual(['HIGH', 'CRITICAL']);
    expect(String(raised[1]!['title'])).toMatch(/all of this month/);
  });

  it('jumping straight past 80% is ONE message, the louder one', async () => {
    const { svc, raised } = rig('81');
    await svc.check(NOV);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      severity: 'CRITICAL',
      dedupeKey: 'assistant-budget:2026-11:100',
    });
  });

  it('a new month warns again', async () => {
    const { svc, raised } = rig('70');
    await svc.check(NOV);
    await svc.check(new Date('2026-12-02T00:00:00Z'));
    expect(raised).toHaveLength(2);
    expect(monthKey(new Date('2026-12-02T00:00:00Z'))).toBe('2026-12');
  });

  it('many checks racing each other send exactly one', async () => {
    const { svc, raised } = rig('70');
    await Promise.all(Array.from({ length: 25 }, () => svc.check(NOV)));
    expect(raised).toHaveLength(1);
  });

  it('gives the claim back when nothing could be raised, so a later answer retries', async () => {
    const { svc, raised, claimed, state } = rig('70');
    state.raiseResult = null;
    await svc.check(NOV);
    expect(claimed.size).toBe(0);
    state.raiseResult = { id: 'i2', isNew: true };
    await svc.check(NOV);
    expect(raised).toHaveLength(2);
    expect(claimed.size).toBe(1);
  });

  it('a budget of 0 raises nothing', async () => {
    const { svc, raised } = rig('5', 0);
    await svc.check(NOV);
    expect(raised).toHaveLength(0);
  });

  it('afterUsage never throws and never rejects, whatever fails underneath', async () => {
    const svc = new AssistantBudgetAlertService(
      {
        monthlyBudgetUsd: async () => {
          throw new Error('settings down');
        },
      } as never,
      {} as never,
      {} as never,
    );
    expect(() => svc.afterUsage(NOV)).not.toThrow();
    await expect(svc.drainInFlight()).resolves.toBeUndefined();
  });

  it('reads the spend ONLY through the budget service (one definition, shared with the cap)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '../../src/modules/assistant/services');
    const alert = readFileSync(join(dir, 'assistant-budget-alert.service.ts'), 'utf8');
    expect(alert).not.toMatch(/costSince|cost_usd|assistantUsage/);
    expect(alert).toMatch(/budget\.monthlySpendUsd/);
    const budget = readFileSync(join(dir, 'assistant-budget.service.ts'), 'utf8');
    expect(budget.match(/costSince\(/g)).toHaveLength(1);
  });
});
