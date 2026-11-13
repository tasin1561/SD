/**
 * THE GATE, unit-level: the real chat service and registry, a scripted model,
 * and a Prisma stand-in that records what is written. The DATABASE guarantees
 * (approval refused without a green run, live pointer, audit rows) are in
 * `assistant-recommendations.e2e-spec.ts`.
 */
import { Prisma } from '@skydrop/db';
import type { EvalCase } from '../../src/modules/assistant/assistant-eval-core';
import {
  EMPTY_OVERLAY,
  applyChange,
} from '../../src/modules/assistant/knowledge/knowledge-overlay';
import { AssistantEvalGateService } from '../../src/modules/assistant/services/assistant-eval-gate.service';
import type { AssistantKnowledgeService } from '../../src/modules/assistant/services/assistant-knowledge.service';
import {
  AssistantModelGateway,
  type AssistantModelRequest,
} from '../../src/modules/assistant/services/assistant-model-gateway';
import { fakeRegistry, message } from '../helpers/assistant-fixtures';

const MARK = 'DRAFT-MARK';
const DRAFT = applyChange(EMPTY_OVERLAY, {
  target: 'prompt_addendum',
  audiences: ['seller'],
  text: MARK,
});

const cases: EvalCase[] = [
  {
    id: 'c1',
    audience: 'seller',
    language: 'en',
    kind: 'where',
    question: 'Where is my wallet?',
    expectLinks: ['/wallet'],
  },
  {
    id: 'c2',
    audience: 'seller',
    language: 'en',
    kind: 'where',
    question: 'Where do I create an order?',
    expectLinks: ['/orders/new'],
  },
];

/** Answers every case well, unless the draft's marker is in the system prompt AND `hurt` says so. */
class ScriptedGateway extends AssistantModelGateway {
  calls: AssistantModelRequest[] = [];
  constructor(private readonly respond: (draft: boolean, q: string, attempt: number) => string) {
    super();
  }
  isConfigured(): boolean {
    return true;
  }
  private attempts = new Map<string, number>();
  async complete(req: AssistantModelRequest, onText: (d: string) => void) {
    this.calls.push(req);
    const sys = JSON.stringify(req.system);
    const draft = sys.includes(MARK);
    const q = JSON.stringify(req.messages[0]);
    const key = `${draft}:${q}`;
    const n = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, n);
    const answer = this.respond(draft, q, n);
    onText(answer);
    return message({ content: [{ type: 'text', text: answer, citations: null } as never] });
  }
}

interface Rig {
  svc: AssistantEvalGateService;
  gateway: ScriptedGateway;
  runUpdate: jest.Mock;
  usage: Array<{ customId: string }>;
  conversationWrites: jest.Mock;
  remaining: { value: Prisma.Decimal };
}

function rig(
  respond:
    | ScriptedGateway['respond' & keyof ScriptedGateway]
    | ((d: boolean, q: string, n: number) => string),
): Rig {
  const gateway = new ScriptedGateway(respond as never);
  const runUpdate = jest.fn(async () => ({ count: 1 }));
  const usage: Array<{ customId: string }> = [];
  const conversationWrites = jest.fn();
  const remaining = { value: new Prisma.Decimal(20) };
  const prisma = {
    client: {
      assistantEvalRun: {
        findUnique: async () => ({
          id: 'run1',
          status: 'RUNNING',
          draftVersionId: 'vD',
          baselineVersionId: null,
        }),
        updateMany: runUpdate,
      },
      assistantMonitorUsage: {
        createMany: async ({ data }: { data: Array<{ customId: string }> }) => {
          usage.push(...data);
        },
      },
      assistantConversation: { create: conversationWrites },
      assistantMessage: { create: conversationWrites },
    },
  };
  const knowledge = {
    overlayFor: async (id: string) => (id === 'vD' ? DRAFT : EMPTY_OVERLAY),
  } as unknown as AssistantKnowledgeService;
  const budget = { monitorRemainingUsd: async () => remaining.value } as never;
  const svc = new AssistantEvalGateService(
    prisma as never,
    budget,
    fakeRegistry(),
    gateway,
    knowledge,
  );
  return { svc, gateway, runUpdate, usage, conversationWrites, remaining };
}

const good = (q: string): string =>
  q.includes('wallet') ? 'Open [Wallet](/wallet).' : 'Open [New order](/orders/new).';

const lastUpdate = (r: Rig) =>
  (r.runUpdate.mock.calls.at(-1) as unknown as [{ data: Record<string, unknown> }])[0].data;

describe('the eval gate', () => {
  it('passes when no case that passed on live fails on the draft', async () => {
    const r = rig((_d, q) => good(q));
    await r.svc.execute('run1', cases);
    const u = lastUpdate(r);
    expect(u).toMatchObject({ status: 'DONE', passed: true, regressions: 0, total: 2 });
    // Not vacuous: every case really passed on both sides.
    expect((u['results'] as Array<{ outcome: string }>).map((x) => x.outcome)).toEqual([
      'same_pass',
      'same_pass',
    ]);
  });

  it('a case that passes on live and fails on the draft is a regression: the run does not pass', async () => {
    const r = rig((draft, q) => (draft && q.includes('wallet') ? 'No idea.' : good(q)));
    await r.svc.execute('run1', cases);
    const u = lastUpdate(r);
    expect(u).toMatchObject({ status: 'DONE', passed: false, regressions: 1 });
    const res = u['results'] as Array<{ id: string; outcome: string }>;
    expect(res.find((x) => x.id === 'c1')?.outcome).toBe('regressed');
    expect(res.find((x) => x.id === 'c2')?.outcome).toBe('same_pass');
  });

  it('a draft that fixes a case that failed on live is not a regression', async () => {
    const r = rig((draft, q) => (!draft && q.includes('wallet') ? 'No idea.' : good(q)));
    await r.svc.execute('run1', cases);
    const u = lastUpdate(r);
    expect(u).toMatchObject({ passed: true, regressions: 0 });
    expect((u['results'] as Array<{ outcome: string }>).some((x) => x.outcome === 'improved')).toBe(
      true,
    );
  });

  it('a draft answer that fails once and passes on the retry is not a regression', async () => {
    const r = rig((draft, q, n) =>
      draft && n === 1 && q.includes('wallet') ? 'No idea.' : good(q),
    );
    await r.svc.execute('run1', cases);
    expect(lastUpdate(r)).toMatchObject({ passed: true, regressions: 0 });
  });

  it('the draft side really runs with the draft version pinned, the live side without it', async () => {
    const r = rig((_d, q) => good(q));
    await r.svc.execute('run1', [cases[0]!]);
    const marks = r.gateway.calls.map((c) => JSON.stringify(c.system).includes(MARK));
    expect(marks).toEqual([false, true]);
  });

  it('records every call on the budget line, once each, and stores no conversation', async () => {
    const r = rig((_d, q) => good(q));
    await r.svc.execute('run1', cases);
    expect(r.usage.length).toBe(4);
    expect(new Set(r.usage.map((u) => u.customId)).size).toBe(4);
    expect(r.conversationWrites).not.toHaveBeenCalled();
    expect(Number(lastUpdate(r)['costUsd'])).toBeGreaterThan(0);
  });

  it('stops and does not pass when the monthly cap leaves no room', async () => {
    const r = rig((_d, q) => good(q));
    r.remaining.value = new Prisma.Decimal(0);
    await r.svc.execute('run1', cases);
    expect(lastUpdate(r)).toMatchObject({ status: 'FAILED', passed: false });
    expect(r.gateway.calls).toHaveLength(0);
  });

  it('a model that errors on the draft counts as a regression, never as a pass', async () => {
    const r = rig((draft, q) => {
      if (draft) throw new Error('boom');
      return good(q);
    });
    await r.svc.execute('run1', [cases[0]!]);
    expect(lastUpdate(r)).toMatchObject({ passed: false, regressions: 1 });
  });
});
