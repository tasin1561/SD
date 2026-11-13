import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ActorType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { groupThemes, type Theme } from '../assistant-monitor-themes';
import { billedFromRealUsd } from '../assistant-pricing';
import { AssistantBatchGateway } from './assistant-batch-gateway';
import { AssistantBudgetService } from './assistant-budget.service';

const DAY = 86_400_000;
const FLAG_DAYS = 30;
const THEME_DAYS = 7;

/** One stored score as the explorer shows it (a person who may read conversations sees it). */
export interface MonitorScoreView {
  readonly conversationId: string;
  readonly answered: string;
  readonly correct: string;
  readonly correctReason: string | null;
  readonly link: string;
  readonly languageMatch: boolean;
  readonly frustration: number;
  readonly hallucination: boolean;
  readonly hallucinationQuote: string | null;
  readonly knowledgeGap: string | null;
  readonly uiConfusion: string | null;
  readonly safety: string;
  readonly safetyQuote: string | null;
  readonly summary: string;
  readonly at: string;
}

type Score = Prisma.AssistantMonitorResultGetPayload<Record<string, never>>;
const view = (r: Score): MonitorScoreView => ({
  conversationId: r.conversationId,
  answered: r.answered.toLowerCase(),
  correct: r.correctForSkydrop.toLowerCase(),
  correctReason: r.correctReason,
  link: r.linkGivenAndRight.toLowerCase(),
  languageMatch: r.languageMatch,
  frustration: r.userFrustration,
  hallucination: r.hallucinationSuspected,
  hallucinationQuote: r.hallucinationQuote,
  knowledgeGap: r.knowledgeGap,
  uiConfusion: r.uiConfusion,
  safety: r.safetyIssue.toLowerCase(),
  safetyQuote: r.safetyQuote,
  summary: r.summary,
  at: r.createdAt.toISOString(),
});

/**
 * Everything the "Monitor" tab reads. READ-ONLY apart from the audit row
 * written before flagged-conversation text leaves (`flags`). The overview is
 * counts, labels and ids only — no conversation words — so `assistant.admin`
 * is enough; scores with a summary or a quote are conversation-derived text
 * and need `assistant.conversations.read` like the explorer they live in.
 */
@Injectable()
export class AssistantMonitorPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AssistantBudgetService,
    private readonly gateway: AssistantBatchGateway,
    private readonly audit: AuditLogService,
  ) {}

  async overview(now: Date = new Date()) {
    const c = this.prisma.client;
    const since = new Date(now.getTime() - THEME_DAYS * DAY);
    const [enabled, cap, spentReal, runs, recent, flagged] = await Promise.all([
      this.budget.monitorEnabled(),
      this.budget.monitorMonthlyBudgetUsd(),
      this.budget.monitorMonthlySpendUsd(now),
      c.assistantMonitorRun.findMany({ orderBy: { startedAt: 'desc' }, take: 14 }),
      c.assistantMonitorResult.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 3000,
        select: { conversationId: true, knowledgeGap: true, uiConfusion: true },
      }),
      c.assistantMonitorResult.count({
        where: {
          safetyIssue: { not: 'NONE' },
          createdAt: { gte: new Date(now.getTime() - FLAG_DAYS * DAY) },
        },
      }),
    ]);
    const latest = runs.find((r) => r.status === 'DONE') ?? null;
    const nightThemes =
      latest === null
        ? []
        : await c.assistantMonitorTheme.findMany({
            where: { runId: latest.id },
            orderBy: [{ count: 'desc' }, { label: 'asc' }],
          });
    const gaps: Theme[] = groupThemes(
      recent.flatMap((r) =>
        r.knowledgeGap === null
          ? []
          : [{ conversationId: r.conversationId, label: r.knowledgeGap }],
      ),
      'topic',
    );
    const pages: Theme[] = groupThemes(
      recent.flatMap((r) =>
        r.uiConfusion === null ? [] : [{ conversationId: r.conversationId, label: r.uiConfusion }],
      ),
      'path',
    );
    const capReal = new Prisma.Decimal(cap);
    return {
      enabled,
      configured: this.gateway.isConfigured(),
      budget: {
        // Shown at the same scale as every AI cost; the cap itself is real spend.
        capUsd: billedFromRealUsd(capReal).toFixed(2),
        spentUsd: billedFromRealUsd(spentReal).toFixed(2),
        usedPct: capReal.isZero() ? null : Number(spentReal.div(capReal).mul(100).toFixed(1)),
      },
      runs: runs.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        status: r.status.toLowerCase(),
        requested: r.requested,
        scored: r.scored,
        errored: r.errored,
        skippedBudget: r.skippedBudget,
        note: r.note,
        summary: r.summary as unknown,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      night: {
        runId: latest?.id ?? null,
        themes: nightThemes.map((t) => ({
          kind: t.kind.toLowerCase(),
          label: t.label,
          count: t.count,
          conversationIds: t.conversationIds as unknown,
        })),
      },
      week: { knowledgeGaps: gaps, uiConfusions: pages },
      safetyFlags: flagged,
    };
  }

  /**
   * "Run now" (Super Admin). Refused while the monitor is off or no API key is
   * set; otherwise audited, then QUEUED (never run inside the request).
   */
  async requestRunNow(staffId: string, enqueue: () => Promise<void>): Promise<{ queued: true }> {
    if (!(await this.budget.monitorEnabled())) {
      throw new ConflictException({
        code: 'MONITOR_OFF',
        message: 'The monitor is switched off. Switch it on in Controls first.',
      });
    }
    if (!this.gateway.isConfigured()) {
      throw new ConflictException({
        code: 'NOT_CONFIGURED',
        message: 'The AI service is not set up on the server.',
      });
    }
    const logged = await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.assistant.monitor.run_now',
      entityType: 'assistant_monitor',
      entityId: null,
      metadata: {},
      severity: 'MEDIUM',
    });
    if (logged === null) {
      throw new ServiceUnavailableException({
        code: 'AUDIT_UNAVAILABLE',
        message: 'This could not be recorded in the audit log, so it was not started.',
      });
    }
    await enqueue();
    return { queued: true };
  }

  /** Safety-flagged conversations, newest first: the words of a conversation, so audited first. */
  async flags(staffId: string, now: Date = new Date()) {
    const logged = await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.assistant.monitor.flags.viewed',
      entityType: 'assistant_monitor',
      entityId: null,
      metadata: {},
      severity: 'MEDIUM',
    });
    if (logged === null) {
      throw new ServiceUnavailableException({
        code: 'AUDIT_UNAVAILABLE',
        message: 'This could not be recorded in the audit log, so it was not opened.',
      });
    }
    const rows = await this.prisma.client.assistantMonitorResult.findMany({
      where: {
        safetyIssue: { not: 'NONE' },
        createdAt: { gte: new Date(now.getTime() - FLAG_DAYS * DAY) },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: rows.map((r) => ({ ...view(r), portal: r.audience.toLowerCase() })) };
  }

  /** Scores for a page of the explorer (the caller already holds `assistant.conversations.read`). */
  async scoresFor(conversationIds: readonly string[]): Promise<Map<string, MonitorScoreView>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.prisma.client.assistantMonitorResult.findMany({
      where: { conversationId: { in: [...conversationIds] } },
      orderBy: { lastMessageId: 'asc' },
    });
    // The latest score per conversation wins.
    return new Map(rows.map((r) => [r.conversationId, view(r)]));
  }

  /** Conversation ids that carry a safety flag (for the explorer's "flagged" filter). */
  async flaggedConversationIds(): Promise<string[]> {
    const rows = await this.prisma.client.assistantMonitorResult.findMany({
      where: { safetyIssue: { not: 'NONE' } },
      select: { conversationId: true },
      distinct: ['conversationId'],
      take: 5000,
    });
    return rows.map((r) => r.conversationId);
  }
}
