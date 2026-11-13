import request from 'supertest';
import { Prisma, StaffRoleKey } from '@skydrop/db';
import {
  AssistantModelGateway,
  type AssistantModelRequest,
} from '../../src/modules/assistant/services/assistant-model-gateway';
import { AssistantBudgetAlertService } from '../../src/modules/assistant/services/assistant-budget-alert.service';
import { FakeGateway, message } from '../helpers/assistant-fixtures';
import {
  bootTestApp,
  createTestStaff,
  drainSystemIssueNotifier,
  drainSystemIssues,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * The 80% / 100% budget warning, against Postgres.
 *
 * The thing to prove is "cannot double-send under concurrency", and only a
 * real unique constraint can: twenty checks fired at the same instant must
 * leave ONE alert row, ONE system issue and ONE round of notifications.
 */
describe('assistant budget alert (e2e)', () => {
  let h: AppHarness;
  let fake: FakeGateway;
  let staffAuth: { Authorization: string };
  let conversationId: string;

  beforeAll(async () => {
    h = await bootTestApp();
    const gateway = h.app.get(AssistantModelGateway, { strict: false });
    jest.spyOn(gateway, 'isConfigured').mockReturnValue(true);
    jest
      .spyOn(gateway, 'complete')
      .mockImplementation((req: AssistantModelRequest, onText: (d: string) => void) =>
        fake.complete(req, onText),
      );
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma, { role: StaffRoleKey.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    const conv = await request(h.baseUrl)
      .post('/admin/assistant/conversations')
      .set(staffAuth)
      .send({})
      .expect(201);
    conversationId = (conv.body as { id: string }).id;
    fake = new FakeGateway([]);
  });

  async function spend(usd: string): Promise<void> {
    await h.prisma.assistantUsage.create({
      data: {
        conversationId,
        audience: 'STAFF',
        callerUserId: '0191a000-0000-7000-8000-0000000000c1',
        model: 'claude-haiku-5-5',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: new Prisma.Decimal(usd),
      },
    });
  }
  const settle = async (): Promise<void> => {
    await h.app.get(AssistantBudgetAlertService, { strict: false }).drainInFlight();
    await drainSystemIssues(h.app);
    await drainSystemIssueNotifier(h.app);
  };
  const issues = () => h.prisma.systemIssue.findMany({ where: { source: 'assistant-budget' } });
  const told = (issueId: string) =>
    h.prisma.notificationLog.count({ where: { eventId: `system_issue:${issueId}` } });

  it('twenty simultaneous checks at 80% leave one alert, one issue, one round of notifications', async () => {
    await spend('64.50');
    const svc = h.app.get(AssistantBudgetAlertService, { strict: false });
    await Promise.all(Array.from({ length: 20 }, () => svc.check()));
    await settle();

    expect(await h.prisma.assistantBudgetAlert.count()).toBe(1);
    const rows = await issues();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: 'HIGH', kind: 'OTHER' });
    const first = await told(rows[0]!.id);
    expect(first).toBeGreaterThanOrEqual(1);

    // Again, and again: nothing more is sent.
    await Promise.all(Array.from({ length: 10 }, () => svc.check()));
    await settle();
    expect(await h.prisma.assistantBudgetAlert.count()).toBe(1);
    expect(await issues()).toHaveLength(1);
    expect(await told(rows[0]!.id)).toBe(first);
  });

  it('below 80% nothing is sent; crossing 100% sends exactly one more, louder', async () => {
    await spend('63.00');
    const svc = h.app.get(AssistantBudgetAlertService, { strict: false });
    await svc.check();
    await settle();
    expect(await h.prisma.assistantBudgetAlert.count()).toBe(0);
    expect(await issues()).toHaveLength(0);

    await spend('2.00'); // 65 = 81%
    await Promise.all([svc.check(), svc.check()]);
    await spend('16.00'); // 81 > 100%
    await Promise.all(Array.from({ length: 8 }, () => svc.check()));
    await settle();

    const alerts = await h.prisma.assistantBudgetAlert.findMany({ orderBy: { threshold: 'asc' } });
    expect(alerts.map((a) => a.threshold)).toEqual([80, 100]);
    const rows = await issues();
    expect(rows.map((r) => r.severity).sort()).toEqual(['CRITICAL', 'HIGH']);
  });

  it('an answer that crosses the line is not delayed or failed by it, and alerts once', async () => {
    await spend('63.9999');
    for (let i = 0; i < 3; i++) {
      fake = new FakeGateway([
        message({ content: [{ type: 'text', text: 'hello', citations: null } as never] }),
      ]);
      const res = await request(h.baseUrl)
        .post(`/admin/assistant/conversations/${conversationId}/messages`)
        .set(staffAuth)
        .send({ text: `question ${i}` });
      expect(res.status).toBe(200);
      expect(String(res.text)).toContain('"type":"done"');
    }
    await settle();
    expect(await h.prisma.assistantBudgetAlert.count()).toBe(1);
    expect(await issues()).toHaveLength(1);
  });
});
