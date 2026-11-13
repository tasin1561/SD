/**
 * Owner, 2026-11-13: "if haiku is using 1$ in our system you will show and
 * store as 2.5$". Caps stay in real spend.
 */
import { Prisma } from '@skydrop/db';
import {
  ASSISTANT_BILLING_MULTIPLIER,
  assistantBilledUsd,
  assistantCostUsd,
  billedFromRealUsd,
  realFromBilledUsd,
} from '../../src/modules/assistant/assistant-pricing';
import { AssistantBudgetService } from '../../src/modules/assistant/services/assistant-budget.service';

const tokens = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 };

describe('2.5x billing', () => {
  it('the multiplier is fixed at 2.5', () => {
    expect(ASSISTANT_BILLING_MULTIPLIER.toString()).toBe('2.5');
  });

  it('what is stored is exactly 2.5x the real Anthropic price', () => {
    const real = assistantCostUsd(tokens);
    expect(assistantBilledUsd(tokens).toString()).toBe(real.mul('2.5').toString());
  });

  it('$1 real is $2.50 billed, and back', () => {
    expect(billedFromRealUsd(1).toString()).toBe('2.5');
    expect(realFromBilledUsd(new Prisma.Decimal('2.5')).toString()).toBe('1');
  });

  it('the budget service reports REAL spend from the billed rows, so the $80 cap is $200 stored', async () => {
    const store = { costSince: jest.fn(async () => new Prisma.Decimal('200')) };
    const settings = { getByKey: jest.fn(async () => ({ value: 80 })) };
    const svc = new AssistantBudgetService(settings as never, store as never);
    expect((await svc.monthlySpendUsd()).toString()).toBe('80');
    expect(await svc.monthlyOk()).toBe(false);
    store.costSince.mockResolvedValue(new Prisma.Decimal('199.99'));
    expect(await svc.monthlyOk()).toBe(true);
  });
});
