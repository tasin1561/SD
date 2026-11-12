import { Prisma } from '@skydrop/db';
import type { AssistantStreamEvent } from '../../src/modules/assistant/assistant.types';
import { chatRig, message, scope, MemoryStore } from '../helpers/assistant-fixtures';

const ok = () => message({ content: [{ type: 'text', text: 'Hi', citations: null } as never] });

async function ask(
  rig: ReturnType<typeof chatRig>,
  text = 'where is my order',
  s = scope(),
): Promise<AssistantStreamEvent[]> {
  const conv = rig.store.seedConversation();
  const events: AssistantStreamEvent[] = [];
  await rig.chat.send(s, conv.id, text, (e) => events.push(e));
  return events;
}
const notice = (e: AssistantStreamEvent[]) => e.find((x) => x.type === 'notice');

describe('budget guard: Claude is NOT called when the assistant must rest', () => {
  it('control: under budget and under the daily cap, the model IS called and answers', async () => {
    const rig = chatRig([ok()], {
      settings: { 'assistant.monthly_budget_usd': '80', 'assistant.daily_messages_per_user': 60 },
    });
    const events = await ask(rig);
    expect(rig.gateway.requests.length).toBe(1);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(notice(events)).toBeUndefined();
  });

  it('at the monthly budget exactly: no model call, a plain resting notice with help links', async () => {
    const store = new MemoryStore();
    store.monthCost = new Prisma.Decimal('80');
    const rig = chatRig([ok()], { store, settings: { 'assistant.monthly_budget_usd': '80' } });
    const events = await ask(rig);
    expect(rig.gateway.requests.length).toBe(0);
    expect(notice(events)).toMatchObject({ code: 'RESTING_BUDGET' });
    expect(
      (notice(events) as unknown as { helpLinks: unknown[] }).helpLinks.length,
    ).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    // and the blocked question is not stored or counted
    expect(rig.store.rows.length).toBe(0);
  });

  it('over the monthly budget: no model call', async () => {
    const store = new MemoryStore();
    store.monthCost = new Prisma.Decimal('80.01');
    const rig = chatRig([ok()], { store, settings: { 'assistant.monthly_budget_usd': 80 } });
    await ask(rig);
    expect(rig.gateway.requests.length).toBe(0);
  });

  it('just under the budget still answers', async () => {
    const store = new MemoryStore();
    store.monthCost = new Prisma.Decimal('79.99');
    const rig = chatRig([ok()], { store, settings: { 'assistant.monthly_budget_usd': 80 } });
    await ask(rig);
    expect(rig.gateway.requests.length).toBe(1);
  });

  it('at the daily per-user cap: no model call, a daily notice', async () => {
    const store = new MemoryStore();
    store.questions = 60;
    const rig = chatRig([ok()], { store, settings: { 'assistant.daily_messages_per_user': 60 } });
    const events = await ask(rig);
    expect(rig.gateway.requests.length).toBe(0);
    expect(notice(events)).toMatchObject({ code: 'RESTING_DAILY' });
  });

  it('the kill switch off: no model call', async () => {
    const rig = chatRig([ok()], { settings: { 'assistant.enabled': false } });
    const events = await ask(rig);
    expect(rig.gateway.requests.length).toBe(0);
    expect(notice(events)).toMatchObject({ code: 'DISABLED' });
  });

  it('the budget is read inside the request: raising it takes effect on the next message', async () => {
    const store = new MemoryStore();
    store.monthCost = new Prisma.Decimal('90');
    const settings: Record<string, unknown> = { 'assistant.monthly_budget_usd': 80 };
    const rig = chatRig([ok()], { store, settings });
    await ask(rig);
    expect(rig.gateway.requests.length).toBe(0);
    settings['assistant.monthly_budget_usd'] = 200;
    await ask(rig);
    expect(rig.gateway.requests.length).toBe(1);
  });

  it('the notice is in the language of the question (Bangla script, Devanagari, else English)', async () => {
    const mk = () => {
      const store = new MemoryStore();
      store.monthCost = new Prisma.Decimal('999');
      return chatRig([ok()], { store });
    };
    const bn = notice(await ask(mk(), 'আমার অর্ডার কোথায়')) as { text: string };
    const hi = notice(await ask(mk(), 'मेरा ऑर्डर कहाँ है')) as { text: string };
    const en = notice(await ask(mk(), 'mera order kahan hai')) as { text: string };
    expect(bn.text).toMatch(/[ঀ-৿]/);
    expect(hi.text).toMatch(/[ऀ-ॿ]/);
    expect([...en.text].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });

  it('no API key: the assistant says "not configured" and does not crash', async () => {
    const rig = chatRig([ok()], { configured: false });
    const events = await ask(rig);
    expect(rig.gateway.requests.length).toBe(0);
    expect(notice(events)).toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('a stale or unreadable setting falls back to the defaults (80 USD / 60 a day), not to "unlimited"', async () => {
    const store = new MemoryStore();
    store.monthCost = new Prisma.Decimal('80');
    const rig = chatRig([ok()], { store, settings: {} });
    await ask(rig);
    expect(rig.gateway.requests.length).toBe(0);
  });
});
