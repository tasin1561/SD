import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ActorType,
  AssistantEvalRunStatus,
  AssistantRecommendationKind,
  AssistantRecommendationStatus,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { assistantBilledUsd } from '../assistant-pricing';
import {
  buildDraftRequest,
  parseDraft,
  renderClaudeCodeTask,
  type Draft,
  type DraftGuideContext,
} from '../assistant-recommendation-draft';
import { GUIDES } from '../knowledge/guides';
import { GLOSSARY } from '../knowledge/glossary';
import {
  describeChange,
  parseKnowledgeChange,
  type KnowledgeChange,
} from '../knowledge/knowledge-overlay';
import { AssistantBudgetService } from './assistant-budget.service';
import { GATE_STALE_MINUTES } from './assistant-eval-gate.service';
import { AssistantKnowledgeService } from './assistant-knowledge.service';
import { AssistantModelGateway } from './assistant-model-gateway';

/** Themes looked at, newest nights first. */
export const THEME_LOOKBACK_DAYS = 14;
/** One drafting pass makes at most this many Haiku calls. */
export const MAX_DRAFTS_PER_RUN = 5;
/** Real USD one drafting call may cost at worst; checked against what is left of the cap first. */
export const DRAFT_WORST_CASE_USD = 0.01;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecommendationFilter = 'new' | 'approved' | 'rejected' | 'live' | 'rolled_back';
const FILTER_STATUS: Record<RecommendationFilter, AssistantRecommendationStatus> = {
  new: AssistantRecommendationStatus.NEW,
  approved: AssistantRecommendationStatus.APPROVED,
  rejected: AssistantRecommendationStatus.REJECTED,
  live: AssistantRecommendationStatus.LIVE,
  rolled_back: AssistantRecommendationStatus.ROLLED_BACK,
};

export function isRecommendationFilter(v: unknown): v is RecommendationFilter {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FILTER_STATUS, v);
}

export interface RecommendationCheckView {
  readonly id: string;
  readonly status: 'RUNNING' | 'DONE' | 'FAILED';
  readonly passed: boolean | null;
  readonly total: number;
  readonly regressions: number;
  readonly note: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /** True when the live version has moved since the check was made. */
  readonly stale: boolean;
  readonly results?: unknown;
}

export interface RecommendationView {
  readonly id: string;
  readonly kind: 'KNOWLEDGE' | 'SYSTEM';
  readonly status: 'NEW' | 'APPROVED' | 'REJECTED' | 'LIVE' | 'ROLLED_BACK';
  readonly title: string;
  readonly problem: string;
  readonly theme: { readonly kind: string; readonly label: string };
  readonly evidence: readonly string[];
  readonly knowledge: KnowledgeChange | null;
  readonly diff: ReturnType<typeof describeChange> | null;
  readonly system: { readonly suggestedChange: string; readonly acceptanceCheck: string } | null;
  readonly task: string | null;
  readonly githubIssueUrl: string | null;
  readonly liveVersionId: string | null;
  readonly draftModel: string;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly check?: RecommendationCheckView | null;
}

export interface RecommendationList {
  readonly liveVersionId: string | null;
  readonly githubAvailable: boolean;
  readonly counts: Record<string, number>;
  readonly items: readonly RecommendationView[];
}

type RecRow = Prisma.AssistantRecommendationGetPayload<Record<string, never>>;

/** The stored `draft` JSON back into a Draft (it was parsed on the way in; this is belt and braces). */
function storedDraft(row: RecRow): Draft | null {
  const d = row.draft;
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const system = o['system'];
  const sys =
    system !== null && typeof system === 'object' ? (system as Record<string, unknown>) : null;
  return {
    kind: row.kind === AssistantRecommendationKind.SYSTEM ? 'SYSTEM' : 'KNOWLEDGE',
    title: row.title,
    problem: row.problem,
    knowledge: parseKnowledgeChange(o['knowledge']),
    system:
      sys !== null &&
      typeof sys['suggestedChange'] === 'string' &&
      typeof sys['acceptanceCheck'] === 'string'
        ? { suggestedChange: sys['suggestedChange'], acceptanceCheck: sys['acceptanceCheck'] }
        : null,
  };
}

/**
 * Recommendations: Haiku DRAFTS, the owner DECIDES.
 *
 * ── GUARANTEES ───────────────────────────────────────────────────────
 *  - NOTHING GOES LIVE BY ITSELF. A draft is a row here plus (after "Run the
 *    check") an unreferenced version. The only code that moves the live
 *    pointer is `approve` and `rollback`, and both are a person's click.
 *  - APPROVAL NEEDS A PASSING GATE: the run named by the recommendation must
 *    be DONE, `passed`, for the very version being published, and that version
 *    must have been built on the version that is live NOW. The check is made
 *    INSIDE the transaction that moves the pointer, so a run that is not
 *    green, or a live version that moved in between, refuses the approval.
 *  - EVERY change is audited (version history row in the same transaction,
 *    `audit_logs` row after it).
 *  - The drafting call has no tools, its output is a strict schema parsed
 *    again here, and the conversation ids on a recommendation come from the
 *    theme, not from the model.
 */
@Injectable()
export class AssistantRecommendationService {
  private readonly log = new Logger(AssistantRecommendationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AssistantBudgetService,
    private readonly gateway: AssistantModelGateway,
    private readonly knowledge: AssistantKnowledgeService,
    private readonly audit: AuditLogService,
  ) {}

  // ── drafting ───────────────────────────────────────────────────────

  /**
   * Draft recommendations from the monitor's recent themes. Only a person
   * asks for this (the button), through the queue. Topics that already have a
   * recommendation are not drafted again.
   */
  async draftFromThemes(): Promise<{ drafted: number; refused: number; skippedBudget: number }> {
    const out = { drafted: 0, refused: 0, skippedBudget: 0 };
    if (!this.gateway.isConfigured()) return out;

    const since = new Date(Date.now() - THEME_LOOKBACK_DAYS * 86_400_000);
    const themes = await this.prisma.client.assistantMonitorTheme.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    const merged = new Map<
      string,
      { kind: 'knowledge_gap' | 'ui_confusion'; label: string; count: number; ids: Set<string> }
    >();
    for (const t of themes) {
      const kind = t.kind === 'UI_CONFUSION' ? 'ui_confusion' : 'knowledge_gap';
      const key = `${kind}:${t.label}`;
      const cur = merged.get(key) ?? { kind, label: t.label, count: 0, ids: new Set<string>() };
      cur.count += t.count;
      if (Array.isArray(t.conversationIds)) {
        for (const id of t.conversationIds) {
          if (typeof id === 'string' && UUID.test(id)) cur.ids.add(id);
        }
      }
      merged.set(key, cur);
    }
    const have = new Set(
      (
        await this.prisma.client.assistantRecommendation.findMany({
          where: { sourceKey: { in: [...merged.keys()] } },
          select: { sourceKey: true },
        })
      ).map((r) => r.sourceKey),
    );
    const todo = [...merged.entries()]
      .filter(([key]) => !have.has(key))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, MAX_DRAFTS_PER_RUN);
    if (todo.length === 0) return out;

    const knownGuideIds = new Set<string>([
      ...GUIDES.map((g) => g.id),
      ...(await this.knowledge.liveOverlay()).guides.map((g) => g.id),
    ]);
    const runId = randomUUID();

    for (const [sourceKey, theme] of todo) {
      const left = await this.budget.monitorRemainingUsd();
      if (left.lessThan(DRAFT_WORST_CASE_USD)) {
        out.skippedBudget++;
        continue;
      }
      const ids = [...theme.ids].slice(0, 20);
      const results = await this.prisma.client.assistantMonitorResult.findMany({
        where: { conversationId: { in: ids } },
        select: { audience: true, summary: true },
        take: 8,
      });
      const request = buildDraftRequest({
        themeKind: theme.kind,
        label: theme.label,
        count: theme.count,
        evidence: results.map((r) => ({ audience: r.audience, summary: r.summary })),
        guides: this.guideContext(theme.label),
      });
      let draft: Draft | null = null;
      try {
        const message = await this.gateway.complete(request, () => undefined);
        const u = message.usage;
        const tokens = {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        };
        const billed = assistantBilledUsd(tokens);
        // Recorded on the monitor's budget line, whatever the outcome: the call was made.
        await this.prisma.client.assistantMonitorUsage.createMany({
          data: [
            {
              runId,
              customId: `draft:${sourceKey}`.slice(0, 200),
              model: request.model,
              ...tokens,
              costUsd: billed,
            },
          ],
          skipDuplicates: true,
        });
        const block = message.content.find((b) => b.type === 'text');
        if (message.stop_reason === 'end_turn' && block !== undefined && block.type === 'text') {
          draft = parseDraft(JSON.parse(block.text) as unknown, knownGuideIds);
        }
        if (draft === null) {
          out.refused++;
          continue;
        }
        await this.prisma.client.assistantRecommendation.create({
          data: {
            kind:
              draft.kind === 'SYSTEM'
                ? AssistantRecommendationKind.SYSTEM
                : AssistantRecommendationKind.KNOWLEDGE,
            sourceKey,
            themeKind: theme.kind,
            themeLabel: theme.label,
            title: draft.title,
            problem: draft.problem,
            evidence: ids as unknown as Prisma.InputJsonValue,
            draft: {
              knowledge: draft.knowledge,
              system: draft.system,
            } as unknown as Prisma.InputJsonValue,
            draftModel: request.model,
            draftCostUsd: billed,
          },
        });
        out.drafted++;
      } catch (e) {
        // One bad draft (unparseable JSON, a duplicate key from a second click) never stops the pass.
        out.refused++;
        this.log.warn(`draft for "${sourceKey}" not stored: ${e instanceof Error ? e.message : e}`);
      }
    }
    return out;
  }

  /** The guides closest to the theme's words get their text shown; every guide's id and title is listed. */
  private guideContext(label: string): DraftGuideContext[] {
    const words = new Set(label.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const scored = GUIDES.map((g) => {
      const hay = `${g.title} ${g.summary} ${(g.keywords ?? []).join(' ')}`.toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score++;
      return { g, score };
    });
    const top = new Set(
      scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((s) => s.g.id),
    );
    return GUIDES.map((g) => ({
      id: g.id,
      audience: g.audience,
      title: g.title,
      summary: g.summary,
      ...(top.has(g.id)
        ? {
            body: g.sections
              .map((s) => `${s.heading}: ${s.steps.join(' ')}`)
              .join(' | ')
              .slice(0, 900),
          }
        : {}),
    }));
  }

  // ── reading ────────────────────────────────────────────────────────

  async list(filter: RecommendationFilter | null): Promise<RecommendationList> {
    const rows = await this.prisma.client.assistantRecommendation.findMany({
      where: filter === null ? {} : { status: FILTER_STATUS[filter] },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const counts = await this.prisma.client.assistantRecommendation.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const live = await this.knowledge.liveVersionId();
    const overlay = await this.knowledge.liveOverlay();
    const runIds = rows.flatMap((r) => (r.lastEvalRunId === null ? [] : [r.lastEvalRunId]));
    const runs = await this.prisma.client.assistantEvalRun.findMany({
      where: { id: { in: runIds } },
      select: {
        id: true,
        status: true,
        passed: true,
        total: true,
        regressions: true,
        note: true,
        startedAt: true,
        finishedAt: true,
        draftVersionId: true,
        baselineVersionId: true,
      },
    });
    const byRun = new Map(runs.map((r) => [r.id, r]));
    return {
      liveVersionId: live,
      githubAvailable: githubConfigured(),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      items: rows.map((r) => {
        const run = r.lastEvalRunId === null ? undefined : byRun.get(r.lastEvalRunId);
        return {
          ...this.toView(r, overlay),
          check:
            run === undefined
              ? null
              : {
                  id: run.id,
                  status: run.status,
                  passed: run.passed,
                  total: run.total,
                  regressions: run.regressions,
                  note: run.note,
                  startedAt: run.startedAt,
                  finishedAt: run.finishedAt,
                  // A green check is only good for the live version it was made against.
                  stale: run.baselineVersionId !== live,
                },
        };
      }),
    };
  }

  async detail(id: string): Promise<RecommendationView> {
    const r = await this.rowOr404(id);
    const run =
      r.lastEvalRunId === null
        ? null
        : await this.prisma.client.assistantEvalRun.findUnique({ where: { id: r.lastEvalRunId } });
    const live = await this.knowledge.liveVersionId();
    return {
      ...this.toView(r, await this.knowledge.liveOverlay()),
      check:
        run === null
          ? null
          : {
              id: run.id,
              status: run.status,
              passed: run.passed,
              total: run.total,
              regressions: run.regressions,
              note: run.note,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
              stale: run.baselineVersionId !== live,
              results: run.results ?? [],
            },
    };
  }

  /** One recommendation as the screen shows it: the draft VERBATIM, a diff for an edit, the task for a system one. */
  private toView(r: RecRow, liveOverlay: Parameters<typeof describeChange>[1]): RecommendationView {
    const draft = storedDraft(r);
    const evidence = Array.isArray(r.evidence)
      ? r.evidence.filter((x): x is string => typeof x === 'string')
      : [];
    const change: KnowledgeChange | null = draft?.knowledge ?? null;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      title: r.title,
      problem: r.problem,
      theme: { kind: r.themeKind, label: r.themeLabel },
      evidence,
      knowledge: change,
      diff:
        change === null
          ? null
          : describeChange(change, liveOverlay, { guides: GUIDES, glossary: GLOSSARY }),
      system: draft?.system ?? null,
      task:
        draft?.system != null
          ? renderClaudeCodeTask({
              title: r.title,
              problem: r.problem,
              evidence,
              suggestedChange: draft.system.suggestedChange,
              acceptanceCheck: draft.system.acceptanceCheck,
            })
          : null,
      githubIssueUrl: r.githubIssueUrl,
      liveVersionId: r.liveVersionId,
      draftModel: r.draftModel,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    };
  }

  history() {
    return this.knowledge.history();
  }

  // ── the check (the eval gate) ──────────────────────────────────────

  /**
   * Prepare a gate run: build the draft version on top of what is live now
   * and open the run row. The run itself is worked by the queue
   * (`AssistantEvalGateService.execute`), never inside this request.
   */
  async openCheck(id: string, staffId: string): Promise<{ runId: string }> {
    const r = await this.rowOr404(id);
    const change = storedDraft(r)?.knowledge ?? null;
    if (
      r.kind !== AssistantRecommendationKind.KNOWLEDGE ||
      change === null ||
      r.status !== AssistantRecommendationStatus.NEW
    ) {
      throw new ConflictException({
        code: 'ASSISTANT_RECOMMENDATION_NOT_CHECKABLE',
        message: 'Only a new knowledge draft can be checked.',
      });
    }
    if (!this.gateway.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'ASSISTANT_NOT_CONFIGURED',
        message: 'The AI provider is not configured, so the check cannot run.',
      });
    }
    const stale = new Date(Date.now() - GATE_STALE_MINUTES * 60_000);
    // A run whose worker died must not block the next one forever.
    await this.prisma.client.assistantEvalRun.updateMany({
      where: {
        recommendationId: id,
        status: AssistantEvalRunStatus.RUNNING,
        startedAt: { lt: stale },
      },
      data: {
        status: AssistantEvalRunStatus.FAILED,
        passed: false,
        note: 'stopped: no result after an hour',
        finishedAt: new Date(),
      },
    });
    const draftVersion = await this.knowledge.createDraftVersion(id, change);
    const runId = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assistant_eval_${id}`}))`;
      const running = await tx.assistantEvalRun.findFirst({
        where: { recommendationId: id, status: AssistantEvalRunStatus.RUNNING },
        select: { id: true },
      });
      if (running !== null) {
        throw new ConflictException({
          code: 'ASSISTANT_CHECK_RUNNING',
          message: 'A check is already running for this draft.',
        });
      }
      const run = await tx.assistantEvalRun.create({
        data: {
          recommendationId: id,
          draftVersionId: draftVersion.id,
          baselineVersionId: draftVersion.parentVersionId,
          startedByStaffId: staffId,
        },
        select: { id: true },
      });
      await tx.assistantRecommendation.update({
        where: { id },
        data: { lastEvalRunId: run.id },
      });
      return run.id;
    });
    await this.auditRec(staffId, 'assistant.recommendation.check', id, { runId });
    return { runId };
  }

  // ── decisions ──────────────────────────────────────────────────────

  /**
   * Approve. A SYSTEM recommendation is only marked approved (a person will
   * carry it out). A KNOWLEDGE one goes LIVE, and only on a passing gate.
   */
  async approve(id: string, staffId: string): Promise<{ status: AssistantRecommendationStatus }> {
    const r = await this.rowOr404(id);
    if (r.kind === AssistantRecommendationKind.SYSTEM) {
      const moved = await this.prisma.client.assistantRecommendation.updateMany({
        where: { id, status: AssistantRecommendationStatus.NEW },
        data: {
          status: AssistantRecommendationStatus.APPROVED,
          decidedByStaffId: staffId,
          decidedAt: new Date(),
        },
      });
      if (moved.count !== 1) throw this.notNew();
      await this.auditRec(staffId, 'assistant.recommendation.approve', id, { kind: 'SYSTEM' });
      return { status: AssistantRecommendationStatus.APPROVED };
    }
    if (r.status !== AssistantRecommendationStatus.NEW) throw this.notNew();
    if (r.lastEvalRunId === null) throw this.noPassingCheck();
    const runId = r.lastEvalRunId;
    const expectedFrom = await this.knowledge.liveVersionId();
    const run = await this.prisma.client.assistantEvalRun.findUnique({
      where: { id: runId },
      select: { draftVersionId: true },
    });
    if (run === null) throw this.noPassingCheck();

    await this.knowledge.moveLive({
      action: 'GO_LIVE',
      toVersionId: run.draftVersionId,
      expectedFrom,
      requireParent: true,
      staffId,
      recommendationId: id,
      evalRunId: runId,
      alsoInTx: async (tx) => {
        // THE GATE, read inside the transaction that moves the pointer: a run
        // that is not DONE, not passed, for another version, or made against
        // a different live version refuses the approval and rolls it all back.
        const green = await tx.assistantEvalRun.findFirst({
          where: {
            id: runId,
            recommendationId: id,
            draftVersionId: run.draftVersionId,
            baselineVersionId: expectedFrom,
            status: AssistantEvalRunStatus.DONE,
            passed: true,
            regressions: 0,
          },
          select: { id: true },
        });
        if (green === null) throw this.noPassingCheck();
        const moved = await tx.assistantRecommendation.updateMany({
          where: { id, status: AssistantRecommendationStatus.NEW, lastEvalRunId: runId },
          data: {
            status: AssistantRecommendationStatus.LIVE,
            liveVersionId: run.draftVersionId,
            decidedByStaffId: staffId,
            decidedAt: new Date(),
          },
        });
        if (moved.count !== 1) throw this.notNew();
      },
    });
    return { status: AssistantRecommendationStatus.LIVE };
  }

  async reject(id: string, staffId: string): Promise<{ status: AssistantRecommendationStatus }> {
    await this.rowOr404(id);
    const moved = await this.prisma.client.assistantRecommendation.updateMany({
      where: {
        id,
        status: { in: [AssistantRecommendationStatus.NEW, AssistantRecommendationStatus.APPROVED] },
      },
      data: {
        status: AssistantRecommendationStatus.REJECTED,
        decidedByStaffId: staffId,
        decidedAt: new Date(),
      },
    });
    if (moved.count !== 1) throw this.notNew();
    await this.auditRec(staffId, 'assistant.recommendation.reject', id, {});
    return { status: AssistantRecommendationStatus.REJECTED };
  }

  /**
   * One-click rollback to any version that has been live before (or to the
   * committed base, `versionId: null`). NEW conversations then start on it;
   * a conversation already running keeps the version it started with.
   */
  async rollback(
    staffId: string,
    versionId: string | null,
    expectedLive: string | null,
  ): Promise<{ liveVersionId: string | null }> {
    if (versionId === expectedLive) {
      throw new ConflictException({
        code: 'ASSISTANT_ALREADY_LIVE',
        message: 'That version is already the live one.',
      });
    }
    if (versionId !== null && !(await this.knowledge.everLive()).has(versionId)) {
      throw new ConflictException({
        code: 'ASSISTANT_NEVER_LIVE',
        message: 'Only a version that has been live before can be rolled back to.',
      });
    }
    const target = versionId === null ? null : await this.knowledge.versionRow(versionId);
    await this.knowledge.moveLive({
      action: 'ROLLBACK',
      toVersionId: versionId,
      expectedFrom: expectedLive,
      requireParent: false,
      staffId,
      recommendationId: null,
      evalRunId: null,
      alsoInTx: async (tx) => {
        // Recommendations whose version is newer than the target are no longer live.
        const newer = await tx.assistantKnowledgeVersion.findMany({
          where: target === null ? {} : { number: { gt: target.number } },
          select: { id: true },
        });
        await tx.assistantRecommendation.updateMany({
          where: {
            status: AssistantRecommendationStatus.LIVE,
            liveVersionId: { in: newer.map((v) => v.id) },
          },
          data: { status: AssistantRecommendationStatus.ROLLED_BACK },
        });
        // Rolling forward to a version that was rolled back makes its recommendation live again.
        if (versionId !== null) {
          await tx.assistantRecommendation.updateMany({
            where: {
              status: AssistantRecommendationStatus.ROLLED_BACK,
              liveVersionId: versionId,
            },
            data: { status: AssistantRecommendationStatus.LIVE },
          });
        }
      },
    });
    return { liveVersionId: versionId };
  }

  // ── plumbing ───────────────────────────────────────────────────────

  async recordGithubIssue(id: string, staffId: string, url: string): Promise<void> {
    await this.prisma.client.assistantRecommendation.update({
      where: { id },
      data: { githubIssueUrl: url },
    });
    await this.auditRec(staffId, 'assistant.recommendation.github_issue', id, { url });
  }

  /** For the issue creator: the SYSTEM task text of one recommendation, or a 404. */
  async taskFor(id: string): Promise<{ title: string; body: string }> {
    const view = this.toView(await this.rowOr404(id), await this.knowledge.liveOverlay());
    if (view.task === null) {
      throw new ConflictException({
        code: 'ASSISTANT_NOT_A_SYSTEM_TASK',
        message: 'Only a system recommendation has a task.',
      });
    }
    return { title: view.title, body: view.task };
  }

  private async rowOr404(id: string): Promise<RecRow> {
    const r = await this.prisma.client.assistantRecommendation.findUnique({ where: { id } });
    if (r === null) {
      throw new NotFoundException({
        code: 'ASSISTANT_RECOMMENDATION_NOT_FOUND',
        message: 'Recommendation not found',
      });
    }
    return r;
  }

  private notNew(): ConflictException {
    return new ConflictException({
      code: 'ASSISTANT_RECOMMENDATION_NOT_OPEN',
      message: 'This recommendation has already been decided.',
    });
  }

  private noPassingCheck(): ConflictException {
    return new ConflictException({
      code: 'ASSISTANT_NO_PASSING_CHECK',
      message:
        'Approval needs a passing check made against the version that is live now. Run the check first.',
    });
  }

  private async auditRec(
    staffId: string,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const logged = await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action,
      entityType: 'assistant_recommendation',
      entityId: id,
      metadata,
      severity: 'MEDIUM',
    });
    if (logged === null) this.log.error(`${action} ${id}: audit_logs write failed`);
  }
}

/** The GitHub issue button exists only when the server has BOTH a token and a repository configured. */
export function githubConfigured(): boolean {
  return githubSettings() !== null;
}

export function githubSettings(): { token: string; repo: string } | null {
  const token = (process.env['GITHUB_ISSUES_TOKEN'] ?? '').trim();
  const repo = (process.env['GITHUB_ISSUES_REPO'] ?? '').trim();
  if (token === '' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { token, repo };
}
