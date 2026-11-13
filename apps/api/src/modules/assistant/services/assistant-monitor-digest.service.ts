import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, SystemIssueKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { topicForIssue } from '../../notification-audience/services/notification-topic-catalog.service';
import { groupThemes } from '../assistant-monitor-themes';
import { dayKey, dhakaDate } from '../assistant-panel-time';
import { AssistantBillingService } from './assistant-billing.service';
import { AssistantBudgetService } from './assistant-budget.service';

/** The generic alert carrier the system-issue emails already use (seeded, pinned by dispatch-templates-exist.spec). */
const SYSTEM_ALERT_TEMPLATE = 'system.alert.email';
const WEEK_MS = 7 * 86_400_000;

export interface WeeklyReport {
  readonly title: string;
  readonly body: string;
  readonly week: string;
}

interface Row {
  readonly conversationId: string;
  readonly answered: string;
  readonly correctForSkydrop: string;
  readonly userFrustration: number;
  readonly hallucinationSuspected: boolean;
  readonly languageMatch: boolean;
  readonly safetyIssue: string;
  readonly knowledgeGap: string | null;
  readonly uiConfusion: string | null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Pure: the three problems and three recommendations, from a week of scores. */
export function weeklyFindings(rows: readonly Row[]): {
  problems: string[];
  recommendations: string[];
} {
  const n = (p: (r: Row) => boolean): number =>
    new Set(rows.filter(p).map((r) => r.conversationId)).size;
  const candidates = [
    {
      n: n((r) => r.safetyIssue !== 'NONE'),
      text: 'conversation flagged for safety (data leak, prompt injection or abuse)',
      many: 'conversations flagged for safety (data leak, prompt injection or abuse)',
      first: true,
    },
    {
      n: n((r) => r.correctForSkydrop === 'NO'),
      text: 'answer that looks wrong for Skydrop',
      many: 'answers that look wrong for Skydrop',
    },
    {
      n: n((r) => r.hallucinationSuspected),
      text: 'answer with a suspected invented fact',
      many: 'answers with a suspected invented fact',
    },
    {
      n: n((r) => r.answered === 'NO'),
      text: 'question left unanswered',
      many: 'questions left unanswered',
    },
    {
      n: n((r) => r.userFrustration >= 2),
      text: 'person clearly frustrated',
      many: 'people clearly frustrated',
    },
    {
      n: n((r) => !r.languageMatch),
      text: 'reply in the wrong language',
      many: 'replies in the wrong language',
    },
  ].filter((c) => c.n > 0);
  // Safety first, then by size.
  candidates.sort((a, b) => Number(b.first === true) - Number(a.first === true) || b.n - a.n);
  const problems = candidates.slice(0, 3).map((c) => `${c.n} ${c.n === 1 ? c.text : c.many}`);

  const gaps = groupThemes(
    rows.flatMap((r) =>
      r.knowledgeGap === null ? [] : [{ conversationId: r.conversationId, label: r.knowledgeGap }],
    ),
    'topic',
  );
  const pages = groupThemes(
    rows.flatMap((r) =>
      r.uiConfusion === null ? [] : [{ conversationId: r.conversationId, label: r.uiConfusion }],
    ),
    'path',
  );
  const recs = [
    ...gaps.map((g) => ({
      n: g.count,
      text: `Write or improve the help guide on "${g.label}" (${plural(g.count, 'conversation', 'conversations')} asked).`,
    })),
    ...pages.map((p) => ({
      n: p.count,
      text: `Look at the page ${p.label}: ${plural(p.count, 'person was', 'people were')} confused there.`,
    })),
  ]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((r) => r.text);
  return { problems, recommendations: recs };
}

/**
 * The weekly e-mail to Super Admins. NO mailer of our own: it goes through
 * the same dispatcher and the same generic alert template the system-issue
 * e-mails use, addressed to whoever holds `assistant.admin` (Super Admin by
 * default), in-app and by e-mail. It is keyed by the Dhaka date, so a replay
 * of the job the same day sends nothing twice. Counts and plain-words topics
 * only — never a conversation's words.
 */
@Injectable()
export class AssistantMonitorDigestService {
  private readonly log = new Logger(AssistantMonitorDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AssistantBudgetService,
    private readonly billing: AssistantBillingService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  async build(now: Date = new Date()): Promise<WeeklyReport> {
    const from = new Date(now.getTime() - WEEK_MS);
    const c = this.prisma.client;
    const [questions, up, down, spend, rows] = await Promise.all([
      c.assistantMessage.count({ where: { isQuestion: true, createdAt: { gte: from, lt: now } } }),
      c.assistantFeedback.count({ where: { rating: 'UP', createdAt: { gte: from, lt: now } } }),
      c.assistantFeedback.count({ where: { rating: 'DOWN', createdAt: { gte: from, lt: now } } }),
      this.billing.rangeTotal(from, now),
      c.assistantMonitorResult.findMany({
        where: { createdAt: { gte: from, lt: now } },
        select: {
          conversationId: true,
          answered: true,
          correctForSkydrop: true,
          userFrustration: true,
          hallucinationSuspected: true,
          languageMatch: true,
          safetyIssue: true,
          knowledgeGap: true,
          uiConfusion: true,
        },
      }),
    ]);
    const { problems, recommendations } = weeklyFindings(rows);
    const d = dhakaDate(now);
    const week = dayKey(d.y, d.m, d.d);
    const list = (xs: string[], none: string): string =>
      xs.length === 0 ? `  ${none}` : xs.map((x, i) => `  ${i + 1}. ${x}`).join('\n');
    const body = [
      `AI assistant, the last 7 days up to ${week}`,
      '',
      `Questions asked: ${questions}`,
      `Cost: $${Number(spend.costUsd).toFixed(2)} (assistant and monitor)`,
      `Thumbs up / down: ${up} / ${down}`,
      `Conversations reviewed by the monitor: ${new Set(rows.map((r) => r.conversationId)).size}`,
      '',
      'Top 3 problems',
      list(problems, 'Nothing stood out this week.'),
      '',
      'Top 3 recommendations',
      list(recommendations, 'No change suggested this week.'),
    ].join('\n');
    return { title: 'AI assistant weekly report', body, week };
  }

  /** Sends it, once per Dhaka day. Skipped while the monitor is off. */
  async sendWeekly(now: Date = new Date()): Promise<{ sent: boolean; reason?: string }> {
    if (!(await this.budget.monitorEnabled())) return { sent: false, reason: 'monitor off' };
    const report = await this.build(now);
    const out = await this.dispatch.dispatch({
      topic: topicForIssue(SystemIssueKind.OTHER),
      templateCode: SYSTEM_ALERT_TEMPLATE,
      category: NotificationCategory.OPERATIONAL,
      title: report.title,
      body: `${report.body}\n\nOpen the AI panel, Monitor tab, for the detail.`,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      audience: [{ kind: 'STAFF_PERMISSION', permission: 'assistant.admin' }],
      triggerEvent: 'assistant.monitor.weekly',
      eventId: `assistant-monitor-weekly:${report.week}`,
    });
    this.log.log(
      { week: report.week, recipients: out.recipients },
      'Assistant weekly report dispatched',
    );
    return { sent: true };
  }
}
