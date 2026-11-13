/**
 * THE VERSION PIN. A conversation keeps the knowledge version it started
 * with: every request in it is built from that version, so the system prompt
 * and the tools are byte-identical turn after turn (a change mid-conversation
 * is a 400 on the preserved thinking blocks), and a draft never changes what
 * anyone is told until it is live AND the conversation starts after that.
 */
import type { AssistantKnowledgeService } from '../../src/modules/assistant/services/assistant-knowledge.service';
import { systemPromptFor } from '../../src/modules/assistant/assistant-system-prompt';
import {
  EMPTY_OVERLAY,
  applyChange,
  type KnowledgeOverlay,
} from '../../src/modules/assistant/knowledge/knowledge-overlay';
import { chatRig, message, scope } from '../helpers/assistant-fixtures';

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as never;
const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: 'tool_use', id, name, input }) as never;

const V1: KnowledgeOverlay = applyChange(EMPTY_OVERLAY, {
  target: 'prompt_addendum',
  audiences: ['seller'],
  text: 'Point people at the Wallet page for COD money questions.',
});
const V2: KnowledgeOverlay = applyChange(V1, {
  target: 'glossary',
  audiences: ['seller'],
  term: 'Zorblax',
  meaning: 'A made-up word that only version two knows.',
  example: 'Your Zorblax is ready.',
});
const OVERLAYS: Record<string, KnowledgeOverlay> = { v1: V1, v2: V2 };
const knowledge = {
  overlayFor: async (id: string) => OVERLAYS[id] ?? EMPTY_OVERLAY,
} as unknown as AssistantKnowledgeService;

async function ask(rig: ReturnType<typeof chatRig>, convId: string, q: string) {
  await rig.chat.send(scope(), convId, q, () => undefined);
}

describe('a draft never changes live answers until it is live', () => {
  it('a conversation with no pinned version gets the committed prompt, byte for byte', async () => {
    const rig = chatRig([message({ content: [text('ok')] })], { knowledge });
    const conv = rig.store.seedConversation();
    await ask(rig, conv.id, 'How do I see my wallet?');
    const sys = rig.gateway.requests[0]!.system as Array<{ text: string }>;
    expect(sys[0]!.text).toBe(systemPromptFor('SELLER'));
  });

  it('a version that exists but is not pinned to this conversation changes nothing', async () => {
    const rig = chatRig([message({ content: [text('ok')] })], { knowledge });
    const conv = rig.store.seedConversation();
    // v2 exists (a draft, or live for later conversations) but this conversation never pinned it.
    await ask(rig, conv.id, 'How do I see my wallet?');
    const sys = rig.gateway.requests[0]!.system as Array<{ text: string }>;
    expect(sys[0]!.text).not.toContain('Wallet page for COD');
  });
});

describe('a conversation keeps the version it started with', () => {
  it('system and tools are byte-identical across its turns, even after the live version moves', async () => {
    const rig = chatRig(
      [
        message({ content: [text('First.')] }),
        message({ content: [text('Second.')] }),
        message({ content: [text('Third, new conversation.')] }),
      ],
      { knowledge },
    );
    rig.store.liveKnowledgeVersion = 'v1';
    const a = await rig.store.createConversation(scope(), null);
    await ask(rig, a.id, 'First question');
    // The owner approves a new version. Conversation A must not notice.
    rig.store.liveKnowledgeVersion = 'v2';
    await ask(rig, a.id, 'Second question');
    const [r1, r2] = rig.gateway.requests;
    expect(JSON.stringify(r2!.system)).toBe(JSON.stringify(r1!.system));
    expect(JSON.stringify(r2!.tools)).toBe(JSON.stringify(r1!.tools));
    expect(JSON.stringify(r1!.system)).toContain('Wallet page for COD');

    // A NEW conversation starts on v2.
    const b = await rig.store.createConversation(scope(), null);
    expect(await rig.store.knowledgeVersionOf(b.id)).toBe('v2');
    await ask(rig, b.id, 'Another question');
    const r3 = rig.gateway.requests[2]!;
    expect(JSON.stringify(r3.tools)).toBe(JSON.stringify(r1!.tools)); // tools never depend on the version
    expect(await rig.store.knowledgeVersionOf(a.id)).toBe('v1');
  });

  it('rollback: new conversations pin the rolled-back version, the running one still has its own', async () => {
    const rig = chatRig([message({ content: [text('x')] })], { knowledge });
    rig.store.liveKnowledgeVersion = 'v2';
    const running = await rig.store.createConversation(scope(), null);
    rig.store.liveKnowledgeVersion = 'v1'; // rollback
    const fresh = await rig.store.createConversation(scope(), null);
    expect(await rig.store.knowledgeVersionOf(running.id)).toBe('v2');
    expect(await rig.store.knowledgeVersionOf(fresh.id)).toBe('v1');
  });

  it('the help lookup reads the pinned version: v2 knows a term v1 does not', async () => {
    const run = async (version: string) => {
      const rig = chatRig(
        [
          message({
            stop_reason: 'tool_use',
            content: [toolUse('t1', 'search_help', { query: 'Zorblax' })],
          }),
          message({ content: [text('done')] }),
        ],
        { knowledge },
      );
      rig.store.liveKnowledgeVersion = version;
      const c = await rig.store.createConversation(scope(), null);
      await ask(rig, c.id, 'What is a Zorblax?');
      return JSON.stringify(rig.gateway.requests[1]!.messages);
    };
    expect(await run('v2')).toContain('made-up word');
    expect(await run('v1')).not.toContain('made-up word');
  });
});

describe('prompt additions', () => {
  it('only the named audiences get them, and the public helper never does', () => {
    expect(systemPromptFor('SELLER', ['rule'])).toContain('EXTRA GUIDANCE FROM THE SKYDROP TEAM');
    expect(systemPromptFor('SELLER', [])).toBe(systemPromptFor('SELLER'));
    expect(systemPromptFor('PUBLIC', ['rule'])).toBe(systemPromptFor('PUBLIC'));
  });
});
