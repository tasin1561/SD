/**
 * Follow-up questions must work.
 *
 * Live bug, 2026-11-12: every SECOND question in a conversation failed
 * with "Something went wrong". The page note ("Page the user is on: …")
 * was attached to the question for the request but not stored, so the
 * next request replayed the first question WITHOUT it. Haiku 5.5 binds
 * each thinking block to the exact conversation before it, sees an edited
 * earlier turn, and rejects the whole request with a 400.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { visibleText } from '../../src/modules/assistant/services/assistant-conversation.service';
import type { AssistantStreamEvent } from '../../src/modules/assistant/assistant.types';
import { chatRig, message, scope } from '../helpers/assistant-fixtures';

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as never;
const thinking = () => ({ type: 'thinking', thinking: '', signature: 'sig-abc' }) as never;
const ctx = { path: '/orders', lastError: { code: 'ORDER_NOT_FOUND', message: 'No such order' } };

async function send(rig: ReturnType<typeof chatRig>, convId: string, q: string) {
  const events: AssistantStreamEvent[] = [];
  await rig.chat.send(scope(), convId, q, (e) => events.push(e), ctx);
  return events;
}

const bindingError = () =>
  Object.assign(
    new Error(
      'messages.0.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.',
    ),
    { name: 'BadRequestError', status: 400 },
  );

describe('a follow-up question replays the conversation exactly as it was sent', () => {
  it('the first question goes out byte-identical in the second request, page note included', async () => {
    const rig = chatRig([
      message({ content: [thinking(), text('Open Orders.')] }),
      message({ content: [thinking(), text('Book from the order page.')] }),
    ]);
    const conv = rig.store.seedConversation();
    await send(rig, conv.id, 'How do I find a parcel?');
    const events = await send(rig, conv.id, 'parcel kivbe book korbo?');

    const [r1, r2] = rig.gateway.requests;
    const firstAsSent = JSON.stringify(r1!.messages[0]);
    expect(firstAsSent).toContain('untrusted_page_context');
    expect(JSON.stringify(r2!.messages[0])).toBe(firstAsSent);
    // and the earlier answer, thinking included, is replayed unmodified
    expect(JSON.stringify(r2!.messages[1])).toContain('sig-abc');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.find((e) => e.type === 'notice')).toBeUndefined();
  });

  it('the stored note never shows in the transcript', async () => {
    const rig = chatRig([message({ content: [text('Open Orders.')] })]);
    const conv = rig.store.seedConversation();
    await send(rig, conv.id, 'How do I find a parcel?');
    const question = rig.store.rows.find((r) => r.isQuestion === true)!;
    expect(JSON.stringify(question.content)).toContain('untrusted_page_context');
    expect(visibleText(question.content)).toBe('How do I find a parcel?');
  });
});

describe('a conversation broken before the fix recovers', () => {
  it('a thinking-binding 400 is retried once with every thinking block removed', async () => {
    const rig = chatRig([
      message({ content: [thinking(), text('Open Orders.')] }),
      message({ content: [text('Book from the order page.')] }),
    ]);
    const conv = rig.store.seedConversation();
    await send(rig, conv.id, 'How do I find a parcel?');

    const real = rig.gateway.complete.bind(rig.gateway);
    let thrown = false;
    rig.gateway.complete = async (req, onText) => {
      if (!thrown) {
        thrown = true;
        throw bindingError();
      }
      return real(req, onText);
    };
    const events = await send(rig, conv.id, 'tmi k?');

    const retried = rig.gateway.requests.at(-1)!;
    const blocks = retried.messages.flatMap((m) =>
      Array.isArray(m.content) ? (m.content as Anthropic.ContentBlockParam[]) : [],
    );
    expect(blocks.some((b) => b.type === 'thinking')).toBe(false);
    expect(events.find((e) => e.type === 'notice')).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('any other 400 is not retried and stays a plain notice', async () => {
    const rig = chatRig([message({ content: [text('never reached')] })]);
    rig.gateway.complete = async () => {
      throw Object.assign(new Error('max_tokens: too large'), {
        name: 'BadRequestError',
        status: 400,
      });
    };
    const conv = rig.store.seedConversation();
    const events = await send(rig, conv.id, 'x');
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ code: 'FAILED' });
  });
});
