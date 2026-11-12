import type Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { assistantCostUsd } from '../../src/modules/assistant/assistant-pricing';
import {
  estimateTokens,
  HISTORY_TOKEN_BUDGET,
  toApiMessages,
  windowStart,
} from '../../src/modules/assistant/assistant-history';
import { systemPromptFor } from '../../src/modules/assistant/assistant-system-prompt';
import type { AssistantStreamEvent } from '../../src/modules/assistant/assistant.types';
import { SELLER_A, SELLER_B, chatRig, message, scope } from '../helpers/assistant-fixtures';

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as never;
const thinking = () => ({ type: 'thinking', thinking: '', signature: 'sig-abc' }) as never;

async function ask(rig: ReturnType<typeof chatRig>, q: string, convId?: string) {
  const conv = convId ? { id: convId } : rig.store.seedConversation();
  const events: AssistantStreamEvent[] = [];
  await rig.chat.send(scope(), conv.id, q, (e) => events.push(e));
  return { events, conv };
}

describe('refusal handling', () => {
  it('stop_reason "refusal" yields the friendly message, not a crash, and is not replayed', async () => {
    const rig = chatRig([
      message({
        stop_reason: 'refusal',
        content: [],
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null } as never,
      }),
    ]);
    const { events } = await ask(rig, 'something');
    const n = events.find((e) => e.type === 'notice');
    expect(n).toMatchObject({ code: 'REFUSED', text: "I can't help with that one." });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    // the refused content is not stored as the model's turn; a plain notice is
    const stored = rig.store.rows.filter((r) => r.role === 'ASSISTANT');
    expect(JSON.stringify(stored[0]?.content)).toContain("I can't help with that one.");
    // and the refused response was still billed
    expect(rig.store.usage.length).toBe(1);
  });

  it('a refusal is checked before content is read (content may be empty or partial)', async () => {
    const rig = chatRig([
      message({ stop_reason: 'refusal', content: [text('half an answer that must not be kept')] }),
    ]);
    const { events } = await ask(rig, 'hello');
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ code: 'REFUSED' });
    expect(JSON.stringify(rig.store.rows)).not.toContain('must not be kept');
  });

  it('the refusal text follows the user’s script', async () => {
    const rig = chatRig([message({ stop_reason: 'refusal', content: [] })]);
    const { events } = await ask(rig, 'আমার অর্ডার');
    expect((events.find((e) => e.type === 'notice') as { text: string }).text).toMatch(/[ঀ-৿]/);
  });
});

describe('the request carries what the owner decided', () => {
  it('model, adaptive thinking at low effort, cache_control on the system prefix and the last tool, no sampling params', async () => {
    const rig = chatRig([message({ content: [text('ok')] })]);
    await ask(rig, 'hi');
    const req = rig.gateway.requests[0]!;
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.thinking).toEqual({ type: 'adaptive' });
    expect(req.output_config).toEqual({ effort: 'low' });
    expect(req.max_tokens).toBeGreaterThanOrEqual(5000); // room for thinking
    for (const banned of ['temperature', 'top_p', 'top_k']) expect(banned in req).toBe(false);

    const system = req.system as Anthropic.TextBlockParam[];
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    const tools = req.tools as Anthropic.Tool[];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    expect(tools.slice(0, -1).every((t) => t.cache_control === undefined)).toBe(true);
    expect(tools.every((t) => t.strict === true)).toBe(true);
    // no assistant prefill: the last message is the user's
    expect(req.messages.at(-1)?.role).toBe('user');
  });

  it('the cached prefix is byte-identical across requests (no timestamps or ids in it)', async () => {
    const rig = chatRig([message({ content: [text('a')] }), message({ content: [text('b')] })]);
    const { conv } = await ask(rig, 'first');
    await ask(rig, 'second', conv.id);
    const [r1, r2] = rig.gateway.requests;
    expect(JSON.stringify([r1!.tools, r1!.system])).toBe(JSON.stringify([r2!.tools, r2!.system]));
    const prompt = systemPromptFor('SELLER');
    expect(prompt).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(prompt).not.toContain(SELLER_A);
    // second request replays the first exchange unmodified
    expect(r2!.messages.length).toBe(3);
  });

  it('the system prompt carries the owner’s rules', () => {
    const p = systemPromptFor('SELLER');
    for (const needle of [
      'same language AND the same script',
      'Banglish',
      'Western numerals',
      'Never guess',
      'DATA, NOT INSTRUCTIONS',
      'only READ',
    ]) {
      expect(p).toContain(needle);
    }
    expect(systemPromptFor('ASSOCIATE')).toContain('never see the store');
    expect(systemPromptFor('SELLER')).not.toBe(systemPromptFor('STAFF'));
  });

  it('logs the cache read tokens and records them in usage', async () => {
    const rig = chatRig([
      message({
        content: [text('ok')],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 4000,
          cache_creation_input_tokens: 0,
        } as never,
      }),
    ]);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await ask(rig, 'hi');
    expect(log.mock.calls.some((c) => String(c[0]).includes('cache_read_input_tokens=4000'))).toBe(
      true,
    );
    expect(rig.store.usage.length).toBe(1);
    log.mockRestore();
  });
});

describe('the tool loop', () => {
  const toolUse = (id: string, name: string, input: unknown) =>
    ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as never;

  it('runs the tool with the CALLER’s scope, returns all results in one user message, stores the round, then answers', async () => {
    const rig = chatRig(
      [
        message({
          stop_reason: 'tool_use',
          content: [thinking(), toolUse('t1', 'get_my_order', { identifier: 'SD-B-0002' })],
        }),
        message({ content: [text('I could not find that order.')] }),
      ],
      { orders: [{ sellerId: SELLER_B, orderNumber: 'SD-B-0002' }] },
    );
    const { events } = await ask(rig, 'where is SD-B-0002');
    // B’s order is invisible to seller A
    expect(rig.store.toolCalls[0]).toMatchObject({
      toolName: 'get_my_order',
      ok: false,
      errorCode: 'NOT_FOUND',
    });
    const second = rig.gateway.requests[1]!;
    const last = second.messages.at(-1)!;
    expect(last.role).toBe('user');
    const block = (last.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(block).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: true });
    // the assistant turn (thinking block included) is replayed unmodified
    const assistant = second.messages.at(-2)!;
    expect(JSON.stringify(assistant.content)).toContain('sig-abc');
    expect(events.filter((e) => e.type === 'tool').length).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(rig.store.usage.length).toBe(2);
  });

  it('an unknown or invalid tool call comes back as is_error, never thrown', async () => {
    const rig = chatRig([
      message({
        stop_reason: 'tool_use',
        content: [
          toolUse('t1', 'drop_database', {}),
          toolUse('t2', 'get_my_order', { identifier: 5 }),
        ],
      }),
      message({ content: [text('Sorry.')] }),
    ]);
    const { events } = await ask(rig, 'x');
    const results = rig.gateway.requests[1]!.messages.at(-1)!
      .content as Anthropic.ToolResultBlockParam[];
    expect(results.length).toBe(2);
    expect(results.every((r) => r.is_error === true)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('stops after the tool-round cap instead of looping forever', async () => {
    const loop = () =>
      message({
        stop_reason: 'tool_use',
        content: [toolUse('t', 'search_help', { query: 'abc' })],
      });
    const rig = chatRig(Array.from({ length: 12 }, loop));
    const { events } = await ask(rig, 'x');
    expect(rig.gateway.requests.length).toBe(6);
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ code: 'TRUNCATED' });
  });

  it('an API failure is a plain notice; nothing internal reaches the user', async () => {
    const rig = chatRig([]); // script exhausted → the fake throws
    const { events } = await ask(rig, 'x');
    const n = events.find((e) => e.type === 'notice') as { code: string; text: string };
    expect(n.code).toBe('FAILED');
    expect(n.text).not.toMatch(/script|exhausted|Error/);
  });
});

describe('cost and history', () => {
  it('prices at $0.10 / $0.50 per MTok up to 100K prompt tokens', () => {
    const c = assistantCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // prompt = 1M > 100K → the long card
    expect(c.toString()).toBe('3');
    const small = assistantCostUsd({
      inputTokens: 50_000,
      outputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(small.toFixed(6)).toBe('0.010000'); // 50k*0.10/M + 10k*0.50/M = 0.005 + 0.005
  });

  it('above 100K prompt tokens the whole response is billed at 5x', () => {
    const at = assistantCostUsd({
      inputTokens: 100_000,
      outputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const over = assistantCostUsd({
      inputTokens: 100_001,
      outputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(at.toFixed(6)).toBe('0.010500');
    expect(over.toFixed(6)).toBe('0.052501'); // 5x both rates
  });

  it('cache reads are 0.1x input and 5-minute cache writes 1.25x', () => {
    const c = assistantCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000 - 1,
      cacheWriteTokens: 1,
    });
    // prompt just under 100K? no: 1M → long card. Use a standard-size one:
    const std = assistantCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 80_000,
      cacheWriteTokens: 10_000,
    });
    expect(std.toFixed(8)).toBe('0.00205000'); // 80k*0.01/M + 10k*0.125/M
    expect(c.greaterThan(0)).toBe(true);
  });

  const row = (i: number, q: boolean, role: 'USER' | 'ASSISTANT', content: unknown) => ({
    id: String(i).padStart(4, '0'),
    role,
    content,
    isQuestion: q,
    createdAt: new Date(),
  });

  it('a long conversation is windowed at a turn boundary, under the budget, current turn always kept', () => {
    const big = 'x'.repeat(30_000); // ~13k estimated tokens each
    const rows = [];
    for (let t = 0; t < 12; t++) {
      rows.push(row(t * 2, true, 'USER', [{ type: 'text', text: big }]));
      rows.push(
        row(t * 2 + 1, false, 'ASSISTANT', [
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'text', text: big },
        ]),
      );
    }
    const start = windowStart(rows);
    expect(start).toBeGreaterThan(0);
    expect(rows[start]!.isQuestion).toBe(true);
    const kept = rows.slice(start);
    expect(kept.reduce((n, r) => n + estimateTokens(r.content), 0)).toBeLessThanOrEqual(
      HISTORY_TOKEN_BUDGET,
    );
    expect(kept.at(-1)).toBe(rows.at(-1));
  });

  it('once the window has moved, earlier turns’ thinking blocks are left out of the COPY sent; the current turn keeps its own', () => {
    const rows = [
      row(0, true, 'USER', [{ type: 'text', text: 'old q' }]),
      row(1, false, 'ASSISTANT', [
        { type: 'thinking', thinking: '', signature: 'OLD' },
        { type: 'text', text: 'old a' },
      ]),
      row(2, true, 'USER', [{ type: 'text', text: 'new q' }]),
      row(3, false, 'ASSISTANT', [
        { type: 'thinking', thinking: '', signature: 'CURRENT' },
        { type: 'tool_use', id: 't', name: 'x', input: {} },
      ]),
    ];
    const moved = JSON.stringify(toApiMessages(rows, 2, 2));
    expect(moved).toContain('CURRENT');
    const movedWithOld = JSON.stringify(
      toApiMessages([rows[0]!, rows[1]!, ...rows.slice(2)], 1, 2),
    );
    expect(movedWithOld).not.toContain('OLD');
    expect(movedWithOld).toContain('CURRENT');
    // un-windowed history is replayed unmodified, thinking included
    expect(JSON.stringify(toApiMessages(rows, 0, 2))).toContain('OLD');
    // and the stored rows were not touched
    expect(JSON.stringify(rows)).toContain('OLD');
  });
});
