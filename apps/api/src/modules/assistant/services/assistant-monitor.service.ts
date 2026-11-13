import { Injectable, Logger } from '@nestjs/common';
import {
  AssistantMonitorRunStatus,
  AssistantMonitorThemeKind,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
  type AssistantAudience,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { assistantBatchBilledUsd, assistantBatchCostUsd } from '../assistant-pricing';
import { MONITOR_MAX_OUTPUT_TOKENS, parseRubric } from '../assistant-monitor-rubric';
import { groupThemes } from '../assistant-monitor-themes';
import {
  buildMonitorRequest,
  buildTranscript,
  estimateInputTokens,
} from '../assistant-monitor-transcript';
import { AssistantBatchGateway, type MonitorBatchItem } from './assistant-batch-gateway';
import { AssistantBudgetService } from './assistant-budget.service';

/** A conversation whose last message is newer than this is probably still going. */
export const IDLE_MINUTES = 20;
/** Only conversations active in this window are looked at; the budget decides how many fit. */
export const LOOKBACK_DAYS = 30;
/** One batch never holds more than this many conversations. */
export const MAX_PER_RUN = 1500;
/** A batch that has not ended after this long is given up on (Anthropic expires batches at 24 h). */
export const BATCH_GIVE_UP_HOURS = 26;
const CHUNK = 20;
/** A run still COLLECTING after this long was abandoned by a crash. */
const LEASE_MINUTES = 15;
const ADVISORY_KEY = 'assistant_monitor_run';

export type MonitorOutcome =
  | { readonly outcome: 'OFF' | 'NOT_CONFIGURED' }
  | {
      readonly outcome:
        | 'NOTHING_TO_DO'
        | 'SKIPPED_BUDGET'
        | 'SUBMITTED'
        | 'PENDING'
        | 'DONE'
        | 'FAILED';
      readonly runId: string;
    };

interface Candidate {
  readonly conversationId: string;
  readonly lastMessageId: string;
  readonly audience: AssistantAudience;
  readonly transcript: string;
}

type AssistantMonitorRun = Prisma.AssistantMonitorRunGetPayload<Record<string, never>>;

const CUSTOM_ID = /^([0-9a-f]{8}-[0-9a-f-]{27}):([0-9a-f]{8}-[0-9a-f-]{27})$/i;

/**
 * The overnight monitor: reads conversations, scores them with Haiku through
 * the Message Batches API (half price), and stores the scores. It WRITES
 * ONLY its own four tables. It imports nothing that builds the live
 * assistant's prompt, tools or knowledge, so a score can never change what
 * the assistant says (pinned from source by `assistant-monitor-isolation.spec.ts`).
 *
 * ── GUARANTEES ───────────────────────────────────────────────────────
 *  - IDEMPOTENT: a result is UNIQUE on (conversation, last message) and a
 *    usage row on (run, custom id); re-reading a finished batch inserts
 *    nothing twice (`createMany skipDuplicates`).
 *  - RESTART-SAFE: the batch id is written to the run row the moment the
 *    batch exists; `resume()` polls from the stored id and never re-submits.
 *  - ONE RUN AT A TIME: starting takes an advisory lock in the same
 *    transaction that looks for an active run.
 *  - CAPPED: every candidate is priced (at its worst case) against what is
 *    left of the monthly cap, read from `AssistantBudgetService`, BEFORE the
 *    batch is created. Candidates that do not fit are left out and counted
 *    as "skipped: budget". Nothing else adds up the monitor's cost.
 *  - OFF by default (`assistant.monitor_enabled`).
 */
@Injectable()
export class AssistantMonitorService {
  private readonly log = new Logger(AssistantMonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AssistantBudgetService,
    private readonly gateway: AssistantBatchGateway,
    private readonly issues: SystemIssueService,
  ) {}

  /** Nightly / "run now": start a pass (or carry on with the one already open). */
  async start(trigger: 'SCHEDULED' | 'MANUAL', now: Date = new Date()): Promise<MonitorOutcome> {
    if (!(await this.budget.monitorEnabled())) return { outcome: 'OFF' };
    if (!this.gateway.isConfigured()) return { outcome: 'NOT_CONFIGURED' };
    const claim = await this.claimRun(trigger, now, true);
    if (claim === null) return { outcome: 'NOTHING_TO_DO', runId: '' };
    return this.advance(claim, now);
  }

  /** Every few minutes: poll the open batch, if there is one. Never starts a new pass. */
  async resume(now: Date = new Date()): Promise<MonitorOutcome | null> {
    if (!this.gateway.isConfigured()) return null;
    const claim = await this.claimRun('SCHEDULED', now, false);
    return claim === null ? null : this.advance(claim, now);
  }

  /**
   * At most one open run, and at most one process BUILDING its batch. The
   * lookup and the insert share one advisory-locked transaction; a run that
   * is still COLLECTING belongs to whoever created it for `LEASE_MINUTES`
   * (a crash before the batch existed is picked up after that, by a guarded
   * `updateMany` that only one caller can win). A SUBMITTED run belongs to
   * nobody: polling it is idempotent, so any process may.
   */
  private claimRun(
    trigger: 'SCHEDULED' | 'MANUAL',
    now: Date,
    createIfNone: boolean,
  ): Promise<{ run: AssistantMonitorRun; collect: boolean } | null> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADVISORY_KEY}))`;
      const open = await tx.assistantMonitorRun.findFirst({
        where: {
          status: {
            in: [AssistantMonitorRunStatus.COLLECTING, AssistantMonitorRunStatus.SUBMITTED],
          },
        },
        orderBy: { startedAt: 'asc' },
      });
      if (open === null) {
        if (!createIfNone) return null;
        const run = await tx.assistantMonitorRun.create({
          data: { trigger, status: AssistantMonitorRunStatus.COLLECTING, startedAt: now },
        });
        return { run, collect: true };
      }
      if (open.status === AssistantMonitorRunStatus.SUBMITTED) return { run: open, collect: false };
      // COLLECTING: only the creator builds the batch, unless its lease ran out.
      const stale = new Date(now.getTime() - LEASE_MINUTES * 60_000);
      const taken = await tx.assistantMonitorRun.updateMany({
        where: {
          id: open.id,
          status: AssistantMonitorRunStatus.COLLECTING,
          updatedAt: { lt: stale },
        },
        data: { note: 'resumed after a stop' },
      });
      return { run: open, collect: taken.count === 1 };
    });
  }

  private advance(
    claim: { run: AssistantMonitorRun; collect: boolean },
    now: Date,
  ): Promise<MonitorOutcome> {
    const { run } = claim;
    if (run.status === AssistantMonitorRunStatus.SUBMITTED && run.batchId !== null) {
      return this.poll(run, run.batchId, now);
    }
    // Still COLLECTING: build the batch only if this caller owns the lease.
    return claim.collect
      ? this.startBatch(run, now)
      : Promise.resolve({ outcome: 'PENDING' as const, runId: run.id });
  }

  // ── collecting ─────────────────────────────────────────────────────

  /** Conversations whose LAST message has no stored score yet. */
  private async candidates(now: Date): Promise<Candidate[]> {
    const idleBefore = new Date(now.getTime() - IDLE_MINUTES * 60_000);
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
    const rows = await this.prisma.client.$queryRaw<
      Array<{ conversation_id: string; audience: AssistantAudience; last_message_id: string }>
    >(Prisma.sql`
      SELECT c.id AS conversation_id, c.audience::text AS audience, m.id AS last_message_id
        FROM assistant_conversations c
        JOIN LATERAL (
          SELECT id, created_at FROM assistant_messages
           WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
        ) m ON true
       WHERE c.deleted_at IS NULL
         AND c.anonymised_at IS NULL
         AND m.created_at >= ${since} AND m.created_at <= ${idleBefore}
         AND EXISTS (SELECT 1 FROM assistant_messages q WHERE q.conversation_id = c.id AND q.is_question)
         AND NOT EXISTS (
           SELECT 1 FROM assistant_monitor_results r
            WHERE r.conversation_id = c.id AND r.last_message_id = m.id)
       ORDER BY m.created_at DESC
       LIMIT ${MAX_PER_RUN}
    `);
    const out: Candidate[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const ids = part.map((r) => r.conversation_id);
      const [messages, attachments, feedback, notices] = await Promise.all([
        this.prisma.client.assistantMessage.findMany({
          where: { conversationId: { in: ids } },
          orderBy: { id: 'asc' },
          select: { id: true, conversationId: true, role: true, content: true },
        }),
        this.prisma.client.assistantAttachment.findMany({
          where: { conversationId: { in: ids } },
          select: { conversationId: true, messageId: true, kind: true, originalName: true },
        }),
        this.prisma.client.assistantFeedback.findMany({
          where: { conversationId: { in: ids } },
          select: { conversationId: true, messageId: true, rating: true, comment: true },
        }),
        this.prisma.client.assistantNotice.findMany({
          where: { conversationId: { in: ids } },
          orderBy: { id: 'asc' },
          select: { conversationId: true, code: true },
        }),
      ]);
      for (const r of part) {
        out.push({
          conversationId: r.conversation_id,
          lastMessageId: r.last_message_id,
          audience: r.audience.toUpperCase() as AssistantAudience,
          transcript: buildTranscript({
            messages: messages.filter((m) => m.conversationId === r.conversation_id),
            attachments: attachments
              .filter((a) => a.conversationId === r.conversation_id)
              .map((a) => ({ messageId: a.messageId, kind: a.kind, name: a.originalName })),
            feedback: feedback.filter((f) => f.conversationId === r.conversation_id),
            notices: notices
              .filter((n) => n.conversationId === r.conversation_id)
              .map((n) => n.code),
          }),
        });
      }
    }
    return out;
  }

  /** Worst-case REAL cost of one request at the batch price (input estimate high, output at the cap). */
  private worstCaseUsd(transcript: string): Prisma.Decimal {
    return assistantBatchCostUsd({
      inputTokens: estimateInputTokens(transcript),
      outputTokens: MONITOR_MAX_OUTPUT_TOKENS,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  }

  private async startBatch(run: AssistantMonitorRun, now: Date): Promise<MonitorOutcome> {
    const found = await this.candidates(now);
    const remaining = await this.budget.monitorRemainingUsd(now);
    let planned = new Prisma.Decimal(0);
    let skipped = 0;
    const accepted: Candidate[] = [];
    for (const c of found) {
      const worst = this.worstCaseUsd(c.transcript);
      if (planned.add(worst).greaterThan(remaining)) {
        skipped++;
        continue;
      }
      planned = planned.add(worst);
      accepted.push(c);
    }

    if (accepted.length === 0) {
      const status =
        skipped > 0
          ? AssistantMonitorRunStatus.SKIPPED_BUDGET
          : AssistantMonitorRunStatus.NOTHING_TO_DO;
      await this.prisma.client.assistantMonitorRun.updateMany({
        where: { id: run.id, status: AssistantMonitorRunStatus.COLLECTING },
        data: {
          status,
          skippedBudget: skipped,
          finishedAt: new Date(),
          note: skipped > 0 ? 'skipped: budget' : 'nothing new to review',
        },
      });
      return { outcome: skipped > 0 ? 'SKIPPED_BUDGET' : 'NOTHING_TO_DO', runId: run.id };
    }

    let batchId: string;
    try {
      batchId = (
        await this.gateway.createBatch(
          accepted.map((c) =>
            buildMonitorRequest(
              `${c.conversationId}:${c.lastMessageId}`,
              c.transcript,
              c.audience.toLowerCase(),
            ),
          ),
        )
      ).id;
    } catch (e) {
      await this.fail(run.id, `could not create the batch: ${reason(e)}`);
      throw e;
    }
    // Written the moment the batch exists: a restart from here on only polls.
    await this.prisma.client.assistantMonitorRun.updateMany({
      where: { id: run.id, status: AssistantMonitorRunStatus.COLLECTING },
      data: {
        status: AssistantMonitorRunStatus.SUBMITTED,
        batchId,
        requested: accepted.length,
        skippedBudget: skipped,
        note: skipped > 0 ? 'skipped: budget (some conversations left out)' : null,
      },
    });
    return { outcome: 'SUBMITTED', runId: run.id };
  }

  // ── polling and storing ────────────────────────────────────────────

  private async poll(
    run: AssistantMonitorRun,
    batchId: string,
    now: Date,
  ): Promise<MonitorOutcome> {
    const status = await this.gateway.retrieveBatch(batchId);
    if (!status.ended) {
      if (now.getTime() - run.startedAt.getTime() > BATCH_GIVE_UP_HOURS * 3_600_000) {
        await this.fail(run.id, `the batch did not finish in ${BATCH_GIVE_UP_HOURS} hours`);
        return { outcome: 'FAILED', runId: run.id };
      }
      return { outcome: 'PENDING', runId: run.id };
    }
    const items = await this.gateway.results(batchId);
    await this.finish(run, items);
    return { outcome: 'DONE', runId: run.id };
  }

  private async fail(runId: string, note: string): Promise<void> {
    await this.prisma.client.assistantMonitorRun.updateMany({
      where: {
        id: runId,
        status: { in: [AssistantMonitorRunStatus.COLLECTING, AssistantMonitorRunStatus.SUBMITTED] },
      },
      data: {
        status: AssistantMonitorRunStatus.FAILED,
        note: note.slice(0, 300),
        finishedAt: new Date(),
      },
    });
  }

  /** Store every item (idempotently), then close the run once and write its themes. */
  private async finish(
    run: AssistantMonitorRun,
    items: readonly MonitorBatchItem[],
  ): Promise<void> {
    const c = this.prisma.client;
    const parsedIds = items.flatMap((i) => {
      const m = CUSTOM_ID.exec(i.customId);
      return m === null || m[1] === undefined ? [] : [m[1].toLowerCase()];
    });
    const audiences = new Map(
      (
        await c.assistantConversation.findMany({
          where: { id: { in: [...new Set(parsedIds)] } },
          select: { id: true, audience: true },
        })
      ).map((r) => [r.id, r.audience]),
    );

    let unreadable = 0;
    let billed = new Prisma.Decimal(0);
    for (const item of items) {
      const m = CUSTOM_ID.exec(item.customId);
      if (item.kind !== 'succeeded' || m === null || m[1] === undefined || m[2] === undefined) {
        unreadable++;
        continue;
      }
      const conversationId = m[1].toLowerCase();
      const lastMessageId = m[2].toLowerCase();
      const cost = assistantBatchBilledUsd(item.usage);
      billed = billed.add(cost);
      const rubric = parseRubric(safeJson(item.text));
      const audience = audiences.get(conversationId);
      if (rubric === null || audience === undefined) unreadable++;
      // The money is real whether or not the answer was readable, so usage is always recorded.
      await c.$transaction([
        c.assistantMonitorUsage.createMany({
          skipDuplicates: true,
          data: [
            {
              runId: run.id,
              customId: item.customId,
              model: item.model,
              inputTokens: item.usage.inputTokens,
              outputTokens: item.usage.outputTokens,
              cacheReadTokens: item.usage.cacheReadTokens,
              cacheWriteTokens: item.usage.cacheWriteTokens,
              costUsd: cost,
            },
          ],
        }),
        c.assistantMonitorResult.createMany({
          skipDuplicates: true,
          data:
            rubric === null || audience === undefined
              ? []
              : [
                  {
                    runId: run.id,
                    conversationId,
                    lastMessageId,
                    audience,
                    model: item.model,
                    answered: rubric.answered.toUpperCase() as 'YES' | 'PARTLY' | 'NO',
                    correctForSkydrop: rubric.correctForSkydrop.toUpperCase() as
                      | 'YES'
                      | 'UNSURE'
                      | 'NO',
                    correctReason: rubric.correctReason,
                    linkGivenAndRight: rubric.linkGivenAndRight.toUpperCase() as
                      | 'YES'
                      | 'NO'
                      | 'NOT_NEEDED',
                    languageMatch: rubric.languageMatch,
                    userFrustration: rubric.userFrustration,
                    hallucinationSuspected: rubric.hallucinationSuspected,
                    hallucinationQuote: rubric.hallucinationQuote,
                    knowledgeGap: rubric.knowledgeGap,
                    uiConfusion: rubric.uiConfusion,
                    safetyIssue: rubric.safetyIssue.toUpperCase() as
                      | 'NONE'
                      | 'DATA_LEAK'
                      | 'PROMPT_INJECTION'
                      | 'ABUSE',
                    safetyQuote: rubric.safetyQuote,
                    summary: rubric.summary,
                  },
                ],
        }),
      ]);
    }

    // This run's results as they stand in the table: the truth, however many times we got here.
    const mine = await c.assistantMonitorResult.findMany({ where: { runId: run.id } });
    const count = (pred: (r: (typeof mine)[number]) => boolean): number => mine.filter(pred).length;
    const gaps = mine.flatMap((r) =>
      r.knowledgeGap === null ? [] : [{ conversationId: r.conversationId, label: r.knowledgeGap }],
    );
    const ui = mine.flatMap((r) =>
      r.uiConfusion === null ? [] : [{ conversationId: r.conversationId, label: r.uiConfusion }],
    );
    const themes = [
      ...groupThemes(gaps, 'topic').map((t) => ({
        ...t,
        kind: AssistantMonitorThemeKind.KNOWLEDGE_GAP,
      })),
      ...groupThemes(ui, 'path').map((t) => ({
        ...t,
        kind: AssistantMonitorThemeKind.UI_CONFUSION,
      })),
    ];
    const flagged = count((r) => r.safetyIssue !== 'NONE');
    const summary = {
      scored: mine.length,
      answered: {
        yes: count((r) => r.answered === 'YES'),
        partly: count((r) => r.answered === 'PARTLY'),
        no: count((r) => r.answered === 'NO'),
      },
      incorrect: count((r) => r.correctForSkydrop === 'NO'),
      hallucinations: count((r) => r.hallucinationSuspected),
      frustrated: count((r) => r.userFrustration >= 2),
      languageMismatch: count((r) => !r.languageMatch),
      safetyFlags: flagged,
      knowledgeGaps: gaps.length,
      uiConfusions: ui.length,
      // Stored / shown figure (real x 2.5), summed from the items just read.
      costUsd: billed.toFixed(8),
    };

    const closed = await c.$transaction(async (tx) => {
      const won = await tx.assistantMonitorRun.updateMany({
        where: { id: run.id, status: AssistantMonitorRunStatus.SUBMITTED },
        data: {
          status: AssistantMonitorRunStatus.DONE,
          scored: mine.length,
          errored: unreadable,
          summary,
          finishedAt: new Date(),
        },
      });
      if (won.count === 1 && themes.length > 0) {
        await tx.assistantMonitorTheme.createMany({
          data: themes.map((t) => ({
            runId: run.id,
            kind: t.kind,
            label: t.label,
            count: t.count,
            conversationIds: t.conversationIds,
          })),
        });
      }
      return won.count === 1;
    });

    if (closed && flagged > 0) {
      // Counts only; the conversations themselves are on the panel, safety first.
      await this.issues.raise({
        kind: SystemIssueKind.OTHER,
        severity: SystemIssueSeverity.HIGH,
        title: `The AI monitor flagged ${flagged} conversation${flagged === 1 ? '' : 's'} for safety`,
        detail: `${flagged} reviewed conversation${flagged === 1 ? ' was' : 's were'} flagged (data leak, prompt injection or abuse). Open the AI panel, Monitor tab: flagged conversations are listed first.`,
        source: 'assistant-monitor',
        dedupeKey: `assistant-monitor-safety:${run.id}`,
      });
    }
    this.log.log(
      { runId: run.id, scored: mine.length, unreadable, flagged },
      'Assistant monitor run finished',
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : 'unknown error';
}
