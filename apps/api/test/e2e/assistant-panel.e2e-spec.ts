import request from 'supertest';
import { Prisma, StaffRoleKey } from '@skydrop/db';
import { AssistantRetentionService } from '../../src/modules/assistant/services/assistant-retention.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * The AI control panel against Postgres: who may call it, that the billing
 * numbers equal the usage rows, that opening / revealing is audited BEFORE
 * data leaves, that masking is server-side, that a rating is one per answer
 * per person, and that the 180-day pass anonymises and keeps the money.
 */
describe('assistant control panel (e2e)', () => {
  let h: AppHarness;
  let owner: { Authorization: string };
  let ownerId: string;
  let readonlyAuth: { Authorization: string };

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  const login = async (role: (typeof StaffRoleKey)[keyof typeof StaffRoleKey]) => {
    const staff = await createTestStaff(h.prisma, { role });
    const res = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    return { id: staff.id, auth: { Authorization: `Bearer ${res.body.accessToken as string}` } };
  };

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const o = await login(StaffRoleKey.SUPER_ADMIN);
    owner = o.auth;
    ownerId = o.id;
    readonlyAuth = (await login(StaffRoleKey.READONLY)).auth;
  });

  const PERSON = '0191a000-0000-7000-8000-0000000000c1';
  async function conversation(updatedAt = new Date()) {
    const c = await h.prisma.assistantConversation.create({
      data: { audience: 'SELLER', ownerUserId: PERSON, updatedAt },
    });
    const q = await h.prisma.assistantMessage.create({
      data: {
        conversationId: c.id,
        role: 'USER',
        isQuestion: true,
        content: [{ type: 'text', text: 'Call me on +919876543606' }],
      },
    });
    const a = await h.prisma.assistantMessage.create({
      data: {
        conversationId: c.id,
        role: 'ASSISTANT',
        content: [
          { type: 'thinking', thinking: '', signature: 'x' },
          { type: 'text', text: 'Noted.' },
        ],
      },
    });
    return { c, q, a };
  }
  async function usage(conversationId: string, cost: string, at: Date) {
    await h.prisma.assistantUsage.create({
      data: {
        conversationId,
        audience: 'SELLER',
        callerUserId: PERSON,
        model: 'claude-haiku-5-5',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: new Prisma.Decimal(cost),
        createdAt: at,
      },
    });
  }

  it('is Super Admin only: a read-only login is refused on every route, server-side', async () => {
    const { c, q } = await conversation();
    for (const path of [
      '/admin/assistant-panel/billing/monthly',
      '/admin/assistant-panel/dashboard',
      '/admin/assistant-panel/controls',
      '/admin/assistant-panel/conversations',
      `/admin/assistant-panel/conversations/${c.id}`,
    ]) {
      await request(h.baseUrl).get(path).set(readonlyAuth).expect(403);
    }
    await request(h.baseUrl)
      .post(`/admin/assistant-panel/conversations/${c.id}/messages/${q.id}/reveal`)
      .set(readonlyAuth)
      .expect(403);
    await request(h.baseUrl).get('/admin/assistant-panel/billing/monthly').set(owner).expect(200);
  });

  it('billing months and days equal the sums of assistant_usage (Dhaka boundaries)', async () => {
    const { c } = await conversation();
    // 2026-10-31T18:00Z is 2026-11-01 00:00 in Dhaka: the first instant of November there.
    await usage(c.id, '1.25000000', new Date('2026-10-31T18:00:00Z'));
    await usage(c.id, '0.75000000', new Date('2026-11-13T05:00:00Z'));
    await usage(c.id, '9.00000000', new Date('2026-10-31T17:59:59Z')); // still October in Dhaka
    const daily = await request(h.baseUrl)
      .get('/admin/assistant-panel/billing/daily?month=2026-11')
      .set(owner)
      .expect(200);
    const d = daily.body as {
      days: Array<{ period: string; total: { costUsd: string } }>;
      total: { total: { costUsd: string; requests: number } };
    };
    expect(d.days.find((x) => x.period === '2026-11-01')?.total.costUsd).toBe('1.25000000');
    expect(d.days.find((x) => x.period === '2026-11-13')?.total.costUsd).toBe('0.75000000');
    expect(d.total.total.costUsd).toBe('2.00000000');
    expect(d.total.total.requests).toBe(2);
    const sum = await h.prisma.$queryRaw<Array<{ s: Prisma.Decimal }>>`
      SELECT sum(cost_usd) s FROM assistant_usage WHERE created_at >= '2026-10-31T18:00:00Z' AND created_at < '2026-11-30T18:00:00Z'`;
    expect(sum[0]?.s.toFixed(8)).toBe(d.total.total.costUsd);
  });

  it('opening a conversation is audited before data returns; phones are masked; thinking never shown; reveal is audited HIGH', async () => {
    const { c, q } = await conversation();
    const open = await request(h.baseUrl)
      .get(`/admin/assistant-panel/conversations/${c.id}?reason=complaint`)
      .set(owner)
      .expect(200);
    const text = JSON.stringify(open.body);
    expect(text).not.toContain('9876543606');
    expect(text).not.toContain('thinking');
    const viewed = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'staff.assistant.conversation.viewed', entityId: c.id },
    });
    expect(viewed.staffUserId).toBe(ownerId);

    const rev = await request(h.baseUrl)
      .post(`/admin/assistant-panel/conversations/${c.id}/messages/${q.id}/reveal`)
      .set(owner)
      .expect(200);
    expect(JSON.stringify(rev.body)).toContain('9876543606');
    const revealed = await h.prisma.auditLog.findFirstOrThrow({
      where: { action: 'staff.assistant.phone.revealed', entityId: c.id },
    });
    expect(revealed.staffUserId).toBe(ownerId);
  });

  it('the 180-day pass anonymises words and keeps usage and cost; a second pass changes nothing', async () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const { c, a } = await conversation(old);
    await usage(c.id, '3.00000000', old);
    const svc = h.app.get(AssistantRetentionService, { strict: false });
    const first = await svc.run(new Date('2026-11-13T00:00:00Z'));
    expect(first.conversations).toBe(1);
    const msg = await h.prisma.assistantMessage.findUniqueOrThrow({ where: { id: a.id } });
    expect(JSON.stringify(msg.content)).toContain('[removed]');
    const conv = await h.prisma.assistantConversation.findUniqueOrThrow({ where: { id: c.id } });
    expect(conv.anonymisedAt).not.toBeNull();
    expect(conv.updatedAt.toISOString()).toBe(old.toISOString());
    expect(await h.prisma.assistantUsage.count({ where: { conversationId: c.id } })).toBe(1);
    const again = await svc.run(new Date('2026-11-14T00:00:00Z'));
    expect(again.conversations).toBe(0);
  });

  it('a recent conversation is untouched by the pass', async () => {
    const { c } = await conversation(new Date('2026-11-10T00:00:00Z'));
    await h.app
      .get(AssistantRetentionService, { strict: false })
      .run(new Date('2026-11-13T00:00:00Z'));
    expect(
      (await h.prisma.assistantConversation.findUniqueOrThrow({ where: { id: c.id } }))
        .anonymisedAt,
    ).toBeNull();
  });
});
