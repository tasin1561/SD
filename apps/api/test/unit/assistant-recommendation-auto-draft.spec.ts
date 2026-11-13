/**
 * Owner, 2026-11-14: "yes chain it" — draft from the monitor's new themes
 * automatically. The chained run drafts only while the monitor is on, and an
 * hour with no new theme makes no model call.
 */
import { AssistantRecommendationService } from '../../src/modules/assistant/services/assistant-recommendation.service';
import {
  JOB_RECOMMENDATION_AUTO_DRAFT,
  RECOMMENDATION_AUTO_DRAFT_CRON,
} from '../../src/modules/assistant/queue/assistant-recommendation.worker';

function rig(monitorOn: boolean, themes: unknown[] = []) {
  const draft = jest.fn();
  const prisma = {
    client: {
      assistantMonitorTheme: { findMany: jest.fn(async () => themes) },
      assistantRecommendation: { findMany: jest.fn(async () => []) },
    },
  };
  const gateway = { isConfigured: () => true, draft };
  const budget = { monitorEnabled: jest.fn(async () => monitorOn) };
  const svc = new AssistantRecommendationService(
    prisma as never,
    budget as never,
    gateway as never,
    {} as never,
    {} as never,
  );
  return { svc, prisma, draft };
}

describe('chained drafting after the monitor', () => {
  it('runs every hour, on its own stable job id', () => {
    expect(JOB_RECOMMENDATION_AUTO_DRAFT).toBe('assistant-recommendation-auto-draft');
    expect(RECOMMENDATION_AUTO_DRAFT_CRON).toBe('15 * * * *');
  });

  it('does nothing at all while the monitor is off', async () => {
    const r = rig(false);
    await expect(r.svc.autoDraftFromThemes()).resolves.toBeNull();
    expect(r.prisma.client.assistantMonitorTheme.findMany).not.toHaveBeenCalled();
  });

  it('with the monitor on but no new theme: reads, finds nothing, calls no model', async () => {
    const r = rig(true, []);
    await expect(r.svc.autoDraftFromThemes()).resolves.toEqual({
      drafted: 0,
      refused: 0,
      skippedBudget: 0,
    });
    expect(r.prisma.client.assistantMonitorTheme.findMany).toHaveBeenCalledTimes(1);
    expect(r.draft).not.toHaveBeenCalled();
  });
});
