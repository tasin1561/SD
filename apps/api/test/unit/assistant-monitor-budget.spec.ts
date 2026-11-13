import { Prisma } from '@skydrop/db';
import { AssistantBudgetService } from '../../src/modules/assistant/services/assistant-budget.service';
import {
  assistantBatchBilledUsd,
  assistantBatchCostUsd,
  assistantBilledUsd,
  assistantCostUsd,
} from '../../src/modules/assistant/assistant-pricing';
import { FakeSettings } from '../helpers/assistant-fixtures';

const tokens = {
  inputTokens: 100_000,
  outputTokens: 20_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

describe('monitor pricing: batches are half price, stored at 2.5x', () => {
  it('real cost is exactly half of the normal price', () => {
    expect(assistantBatchCostUsd(tokens).toString()).toBe(
      assistantCostUsd(tokens).div(2).toString(),
    );
  });

  it('the stored figure is the half-price real cost times 2.5 (1.25x the normal real price)', () => {
    expect(assistantBatchBilledUsd(tokens).toString()).toBe(
      assistantCostUsd(tokens).mul('1.25').toString(),
    );
    expect(assistantBatchBilledUsd(tokens).toString()).toBe(
      assistantBilledUsd(tokens).div(2).toString(),
    );
  });

  it('prices a known request exactly: 3000 in / 200 out', () => {
    const t = { inputTokens: 3000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // normal: 3000*0.10/1M + 200*0.50/1M = 0.0004 ; batch real 0.0002 ; stored 0.0005
    expect(assistantBatchCostUsd(t).toFixed(8)).toBe('0.00020000');
    expect(assistantBatchBilledUsd(t).toFixed(8)).toBe('0.00050000');
  });
});

describe('monitor budget: one function, real dollars', () => {
  const make = (billed: string, settings: Record<string, unknown>) => {
    const store = { monitorCostSince: jest.fn(async () => new Prisma.Decimal(billed)) };
    const svc = new AssistantBudgetService(new FakeSettings(settings) as never, store as never);
    return { svc, store };
  };

  it('is OFF unless the setting says true', async () => {
    expect(await make('0', {}).svc.monitorEnabled()).toBe(false);
    expect(await make('0', { 'assistant.monitor_enabled': false }).svc.monitorEnabled()).toBe(
      false,
    );
    expect(await make('0', { 'assistant.monitor_enabled': true }).svc.monitorEnabled()).toBe(true);
  });

  it('converts the stored (billed) sum back to real spend', async () => {
    const { svc } = make('50', { 'assistant.monitor_monthly_budget_usd': '20' });
    expect((await svc.monitorMonthlySpendUsd()).toString()).toBe('20');
  });

  it('the $20 REAL cap is reached at $50 stored, and remaining never goes negative', async () => {
    const at = make('50', { 'assistant.monitor_monthly_budget_usd': 20 });
    expect((await at.svc.monitorRemainingUsd()).toString()).toBe('0');
    const over = make('80', { 'assistant.monitor_monthly_budget_usd': 20 });
    expect((await over.svc.monitorRemainingUsd()).toString()).toBe('0');
    const under = make('25', { 'assistant.monitor_monthly_budget_usd': 20 });
    expect((await under.svc.monitorRemainingUsd()).toString()).toBe('10');
  });

  it('defaults the cap to $20', async () => {
    expect(await make('0', {}).svc.monitorMonthlyBudgetUsd()).toBe(20);
  });

  it('sums from the first of the UTC month', async () => {
    const { svc, store } = make('0', {});
    await svc.monitorMonthlySpendUsd(new Date('2026-11-13T10:00:00Z'));
    expect(store.monitorCostSince).toHaveBeenCalledWith(new Date('2026-11-01T00:00:00Z'));
  });
});
