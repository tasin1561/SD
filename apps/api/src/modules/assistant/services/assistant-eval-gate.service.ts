import { Injectable, Logger } from '@nestjs/common';
import { AssistantEvalRunStatus, Prisma, type AssistantAudience } from '@skydrop/db';
import { ALL_PERMISSION_KEYS } from '../../../common/auth/permissions';
import { ALL_SELLER_PERMISSION_KEYS } from '../../../common/auth/seller-permissions';
import { ALL_STORE_PERMISSION_KEYS } from '../../../common/auth/store-permissions';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  extractLinks,
  loadCases,
  scoreAnswer,
  validateCases,
  type EvalCase,
  type Verdict,
} from '../assistant-eval-core';
import type { CallerScope } from '../assistant.types';
import { EphemeralChatStore } from './assistant-ephemeral-store';
import { AssistantBudgetService } from './assistant-budget.service';
import { AssistantChatService } from './assistant-chat.service';
import { AssistantKnowledgeService } from './assistant-knowledge.service';
import { AssistantModelGateway } from './assistant-model-gateway';
import { AssistantToolRegistry } from './assistant-tool-registry.service';

/** Cases asked at the same time. Each is two chat turns (live and draft) plus at most one retry. */
export const GATE_CONCURRENCY = 3;
/** Real USD one case may cost at worst (two sides, a retry, several tool rounds). Checked against what is left of the cap BEFORE the case starts. */
export const GATE_CASE_WORST_CASE_USD = 0.05;
/** A run still RUNNING after this long lost its worker. */
export const GATE_STALE_MINUTES = 60;

export type SideStatus = 'pass' | 'fail' | 'error';
export type CaseOutcome = 'same_pass' | 'same_fail' | 'improved' | 'regressed';

export interface GateSide {
  readonly status: SideStatus;
  readonly detail: string;
  /** The start of the answer, so the owner can judge it. Eval questions only: no customer data. */
  readonly answer: string;
  readonly tools: readonly string[];
  readonly retried: boolean;
}

export interface GateCaseResult {
  readonly id: string;
  readonly audience: string;
  readonly language: string;
  readonly kind: string;
  readonly question: string;
  readonly live: GateSide;
  readonly draft: GateSide;
  readonly outcome: CaseOutcome;
}

/** The synthetic person each audience's eval question is asked as. It owns nothing, so a data lookup finds nothing. */
const GATE_USER = '00000000-0000-7000-8000-00000000e7a2';
const GATE_TENANT = '00000000-0000-7000-8000-00000000e7a3';

function gateScope(audience: Lowercase<Exclude<AssistantAudience, 'PUBLIC'>>): CallerScope {
  const base = { userId: GATE_USER, impersonatingStaffId: null } as const;
  switch (audience) {
    case 'staff':
      return {
        ...base,
        audience: 'STAFF',
        sellerId: null,
        storeId: null,
        orderScope: null,
        permissions: ALL_PERMISSION_KEYS,
      };
    case 'seller':
      return {
        ...base,
        audience: 'SELLER',
        sellerId: GATE_TENANT,
        storeId: null,
        orderScope: null,
        permissions: ALL_SELLER_PERMISSION_KEYS,
      };
    case 'store':
      return {
        ...base,
        audience: 'STORE',
        sellerId: GATE_TENANT,
        storeId: GATE_TENANT,
        orderScope: 'ALL',
        permissions: ALL_STORE_PERMISSION_KEYS,
      };
    case 'associate':
      return {
        ...base,
        audience: 'ASSOCIATE',
        sellerId: GATE_TENANT,
        storeId: GATE_TENANT,
        orderScope: 'OWN',
        permissions: ALL_STORE_PERMISSION_KEYS,
      };
  }
}

/** The budget the chat service consults per request: the gate checks its own line before each case. */
const OPEN_BUDGET = { check: async () => ({ ok: true }), monthlyOk: async () => true };
/** Eval questions carry no files. */
const NO_ATTACHMENTS = { requireUnsent: async () => [], loadBlocks: async () => new Map() };

function why(v: Verdict): string {
  const parts: string[] = [];
  if (!v.languageOk) parts.push('wrong language or script');
  if (v.linksMissing.length > 0) parts.push(`missing link: ${v.linksMissing.join(', ')}`);
  if (v.wordsMissing.length > 0) parts.push(`missing words: ${v.wordsMissing.join(', ')}`);
  if (v.anyMissing) parts.push('none of the expected words present');
  if (v.forbiddenHits.length > 0) parts.push(`forbidden content: ${v.forbiddenHits.join(', ')}`);
  return parts.join('; ') || 'empty answer';
}

/**
 * THE GATE. Asks every saved eval case (`eval/assistant/*.json`) of the LIVE
 * knowledge version and of the DRAFT version, each through the real
 * `AssistantChatService` (same prompt builder, same tools, same model, same
 * search) with only the pinned knowledge version differing. A draft may go
 * live only if no case that passed on live fails on the draft.
 *
 *  - Nothing is faked here: the model gateway is the one the chat uses (the
 *    specs substitute their fake there, as everywhere else).
 *  - The conversations are in memory (`EphemeralChatStore`): nothing is
 *    stored, nothing reaches the explorer, the live usage line or the monitor.
 *  - Every call is priced and recorded on the MONITOR's budget line
 *    (`assistant_monitor_usage`, billed 2.5x, UNIQUE per (run, call) so a
 *    re-run of a step stores nothing twice), and each case is started only if
 *    what is left of the monitor's real-USD cap covers its worst case.
 *  - A draft side that fails where live passed is asked once more before it
 *    counts as a regression (a model does not answer identically twice).
 */
@Injectable()
export class AssistantEvalGateService {
  private readonly log = new Logger(AssistantEvalGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: AssistantBudgetService,
    private readonly registry: AssistantToolRegistry,
    private readonly gateway: AssistantModelGateway,
    private readonly knowledge: AssistantKnowledgeService,
  ) {}

  /**
   * Run one queued gate run to the end. Safe to call twice: only a RUNNING run is worked on.
   * `cases` defaults to the saved eval (`eval/assistant/*.json`); specs pass a few.
   */
  async execute(runId: string, cases: readonly EvalCase[] = loadCases()): Promise<void> {
    const run = await this.prisma.client.assistantEvalRun.findUnique({ where: { id: runId } });
    if (run === null || run.status !== AssistantEvalRunStatus.RUNNING) return;
    let billed = new Prisma.Decimal(0);
    try {
      const problems = validateCases(cases);
      if (problems.length > 0) throw new Error(`eval case files are not valid: ${problems[0]}`);
      if (!this.gateway.isConfigured()) throw new Error('the AI provider is not configured');

      const results: GateCaseResult[] = [];
      let stopped: string | null = null;
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          if (stopped !== null) return;
          const i = next++;
          const c = cases[i];
          if (c === undefined) return;
          const left = await this.budget.monitorRemainingUsd();
          if (left.lessThan(GATE_CASE_WORST_CASE_USD)) {
            stopped = 'skipped: budget (the monthly cap leaves no room for another case)';
            return;
          }
          const r = await this.runCase(run.id, c, run.baselineVersionId, run.draftVersionId);
          billed = billed.add(r.billed);
          results[i] = r.result;
        }
      };
      await Promise.all(Array.from({ length: GATE_CONCURRENCY }, () => worker()));

      const done = results.filter((r): r is GateCaseResult => r !== undefined);
      const regressions = done.filter((r) => r.outcome === 'regressed').length;
      const complete = stopped === null && done.length === cases.length;
      await this.prisma.client.assistantEvalRun.updateMany({
        where: { id: run.id, status: AssistantEvalRunStatus.RUNNING },
        data: {
          status: complete ? AssistantEvalRunStatus.DONE : AssistantEvalRunStatus.FAILED,
          // Passed ONLY when every case ran and none regressed.
          passed: complete && regressions === 0,
          total: done.length,
          regressions,
          results: done as unknown as Prisma.InputJsonValue,
          note: stopped,
          costUsd: billed,
          finishedAt: new Date(),
        },
      });
    } catch (e) {
      this.log.error(`eval gate ${run.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.client.assistantEvalRun.updateMany({
        where: { id: run.id, status: AssistantEvalRunStatus.RUNNING },
        data: {
          status: AssistantEvalRunStatus.FAILED,
          passed: false,
          note: e instanceof Error ? e.message.slice(0, 300) : 'failed',
          costUsd: billed,
          finishedAt: new Date(),
        },
      });
    }
  }

  private async runCase(
    runId: string,
    c: EvalCase,
    liveVersionId: string | null,
    draftVersionId: string,
  ): Promise<{ result: GateCaseResult; billed: Prisma.Decimal }> {
    let billed = new Prisma.Decimal(0);
    const side = async (versionId: string | null, tag: string): Promise<GateSide> => {
      const r = await this.ask(runId, c, versionId, `${c.id}:${tag}`);
      billed = billed.add(r.billed);
      return r.side;
    };
    const live = await side(liveVersionId, 'live');
    let draft = await side(draftVersionId, 'draft');
    if (live.status === 'pass' && draft.status !== 'pass') {
      const again = await side(draftVersionId, 'draft-retry');
      draft = { ...again, retried: true };
    }
    const outcome: CaseOutcome =
      live.status === 'pass'
        ? draft.status === 'pass'
          ? 'same_pass'
          : 'regressed'
        : draft.status === 'pass'
          ? 'improved'
          : 'same_fail';
    return {
      result: {
        id: c.id,
        audience: c.audience,
        language: c.language,
        kind: c.kind,
        question: c.question,
        live,
        draft,
        outcome,
      },
      billed,
    };
  }

  /** One question to the chat service with the given knowledge version pinned. */
  private async ask(
    runId: string,
    c: EvalCase,
    versionId: string | null,
    customId: string,
  ): Promise<{ side: GateSide; billed: Prisma.Decimal }> {
    const scope = gateScope(c.audience);
    const store = new EphemeralChatStore(scope.audience, versionId);
    // The REAL chat service; only the store (in memory) and the budget (the gate checks its own line) differ.
    const chat = new AssistantChatService(
      store as never,
      OPEN_BUDGET as never,
      this.registry,
      this.gateway,
      NO_ATTACHMENTS as never,
      undefined,
      this.knowledge,
    );
    let text = '';
    const links: string[] = [];
    const seen: { failure: string | null } = { failure: null };
    try {
      await chat.send(scope, store.conversationId, c.question, (ev) => {
        if (ev.type === 'text') text += ev.delta;
        else if (ev.type === 'notice') {
          for (const l of ev.helpLinks) links.push(l.path);
          seen.failure = `notice ${ev.code}`;
        }
      });
    } catch (e) {
      seen.failure = e instanceof Error ? e.message.slice(0, 200) : 'failed';
    }

    let billed = new Prisma.Decimal(0);
    for (const [i, u] of store.usage.entries()) {
      billed = billed.add(u.costUsd);
      await this.prisma.client.assistantMonitorUsage.createMany({
        data: [
          {
            runId,
            customId: `gate:${customId}:${i}`,
            model: 'claude-haiku-5-5',
            ...u.tokens,
            costUsd: u.costUsd,
          },
        ],
        skipDuplicates: true,
      });
    }

    const answer = { text, links: [...extractLinks(text), ...links] };
    const verdict = scoreAnswer(c, answer);
    // A notice instead of an answer is an error, not a wrong answer.
    const status: SideStatus =
      seen.failure !== null && text.trim() === '' ? 'error' : verdict.pass ? 'pass' : 'fail';
    return {
      billed,
      side: {
        status,
        detail: status === 'pass' ? '' : (seen.failure ?? why(verdict)),
        answer: text.slice(0, 600),
        tools: store.tools,
        retried: false,
      },
    };
  }
}
