import request from 'supertest';
import { StaffRole } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * The capacity monitor, against a real database.
 *
 * Almost everything here is a live probe — connection counts, database
 * size, Redis memory, queue depth. A mocked version would assert that
 * the code returns the numbers the mock was told to return, which is no
 * evidence at all that the queries run. The point of this suite is that
 * they do.
 */
describe('System capacity (e2e)', () => {
  let h: AppHarness;
  let superAdmin: { Authorization: string };

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  async function loginAs(role: StaffRole): Promise<{ Authorization: string }> {
    const staff = await createTestStaff(h.prisma, { role });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    return { Authorization: `Bearer ${login.body.accessToken}` };
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    superAdmin = await loginAs(StaffRole.SUPER_ADMIN);
  });

  it('reports live readings, each with a ceiling and a remedy', async () => {
    const res = await request(h.baseUrl).get('/admin/system/capacity').set(superAdmin).expect(200);

    expect(res.body.metrics.length).toBeGreaterThan(0);

    const conns = res.body.metrics.find((m: { key: string }) => m.key === 'db_connections');
    expect(conns).toBeDefined();
    // Measured, not configured: Postgres knows its own connection limit.
    expect(conns.ceilingSource).toBe('MEASURED');
    expect(conns.ceiling).toBeGreaterThan(0);
    expect(conns.current).toBeGreaterThan(0);

    // Every metric must say what breaks and what to do. A gauge without
    // those has moved the problem to whoever is reading it at 3am.
    //
    // "Nothing to do." is a legitimate remedy for a healthy metric, so
    // the length floor applies only where something IS wrong — which is
    // the case the prose exists for.
    for (const m of res.body.metrics) {
      expect(m.consequence.length).toBeGreaterThan(20);
      expect(m.remedy.length).toBeGreaterThan(0);
      if (m.status !== 'OK') expect(m.remedy.length).toBeGreaterThan(20);
    }
  });

  it('takes the database disk ceiling from settings, and says so', async () => {
    // The ceiling Postgres cannot know. If this ever silently became a
    // hardcoded guess, the gauge would read plausibly and be wrong.
    const res = await request(h.baseUrl).get('/admin/system/capacity').set(superAdmin).expect(200);
    const storage = res.body.metrics.find((m: { key: string }) => m.key === 'db_storage');
    expect(storage.ceilingSource).toBe('CONFIGURED');

    await h.prisma.systemSetting.update({
      where: { key: 'capacity.db_storage_gb' },
      data: { valueInt: 40 },
    });
    const after = await request(h.baseUrl)
      .get('/admin/system/capacity')
      .set(superAdmin)
      .expect(200);
    expect(after.body.metrics.find((m: { key: string }) => m.key === 'db_storage').ceiling).toBe(
      40,
    );
  });

  it('reports whether this process owns the background queues', async () => {
    // The single fact that decides whether a second API instance is
    // safe to start.
    const res = await request(h.baseUrl).get('/admin/system/capacity').set(superAdmin).expect(200);
    expect(typeof res.body.topology.workersEnabledHere).toBe('boolean');
    expect(res.body.topology.note.length).toBeGreaterThan(10);
  });

  it('is SUPER_ADMIN only — it describes how to bring the platform down', async () => {
    const finance = await loginAs(StaffRole.FINANCE);
    await request(h.baseUrl).get('/admin/system/capacity').set(finance).expect(403);

    await request(h.baseUrl).get('/admin/system/capacity').expect(401);
  });
});
