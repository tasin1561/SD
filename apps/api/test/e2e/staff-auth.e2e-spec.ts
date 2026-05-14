import request from 'supertest';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

const STAFF_COOKIE = '__Host-staffRefresh';

function toCookieList(header: string | string[] | undefined): string[] {
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

describe('Staff auth (e2e)', () => {
  let h: AppHarness;
  let staff: Awaited<ReturnType<typeof createTestStaff>>;

  beforeAll(async () => {
    h = await bootTestApp();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma);
    staff = await createTestStaff(h.prisma);
  });

  it('login → me → refresh rotation → replay detected, family revoked', async () => {
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);

    expect(login.body.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(login.body.expiresIn).toBe(300);

    const cookies = toCookieList(login.headers['set-cookie']);
    const refreshCookieLine = cookies.find((c) => c.startsWith(STAFF_COOKIE));
    expect(refreshCookieLine).toBeDefined();
    expect(refreshCookieLine).toMatch(/HttpOnly/);
    expect(refreshCookieLine).toMatch(/Secure/);
    expect(refreshCookieLine).toMatch(/SameSite=Strict/);
    const originalCookie = `${STAFF_COOKIE}=${refreshCookieLine!.split(';')[0]!.split('=')[1]}`;

    const me = await request(h.baseUrl)
      .get('/auth/staff/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(staff.email);
    expect(me.body.role).toBe('SUPER_ADMIN');

    const rotated = await request(h.baseUrl)
      .post('/auth/staff/refresh')
      .set('Cookie', originalCookie)
      .expect(200);
    expect(rotated.body.accessToken).not.toEqual(login.body.accessToken);
    const rotatedCookies = toCookieList(rotated.headers['set-cookie']);
    const newCookieLine = rotatedCookies.find((c) => c.startsWith(STAFF_COOKIE))!;
    const newCookie = `${STAFF_COOKIE}=${newCookieLine.split(';')[0]!.split('=')[1]}`;
    expect(newCookie).not.toEqual(originalCookie);

    // Replay the original (now-revoked) cookie. Should fail AND burn the family.
    await request(h.baseUrl)
      .post('/auth/staff/refresh')
      .set('Cookie', originalCookie)
      .expect(401);

    // Audit row from THIS replay attempt: severity HIGH, revokedCount 1
    // (the new cookie that was still active).
    const auditAfterReplay = await h.prisma.auditLog.findMany({
      where: { action: 'security.refresh_replay_detected' },
    });
    expect(auditAfterReplay).toHaveLength(1);
    expect((auditAfterReplay[0]!.metadata as { severity: string }).severity).toBe('HIGH');
    expect((auditAfterReplay[0]!.metadata as { revokedCount: number }).revokedCount).toBe(1);

    // The NEW cookie that came back from the legitimate rotation should
    // now also be dead — family revoke landed. (This second attempt is
    // also a replay-of-revoked, so it writes its own audit row; we don't
    // assert that count beyond confirming it stays >= 1.)
    await request(h.baseUrl).post('/auth/staff/refresh').set('Cookie', newCookie).expect(401);
  });

  it('login: wrong password returns generic 401 + audit reason wrong_password', async () => {
    await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: 'WRONG' })
      .expect(401)
      .expect((res) => expect(res.body.code).toBe('INVALID_CREDENTIALS'));

    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'staff.login.failure' } });
    expect(audit).toBeTruthy();
    expect((audit!.metadata as { reason: string }).reason).toBe('wrong_password');
  });

  it('login: unknown email → same generic 401, entityId null in audit', async () => {
    await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: 'ghost@example.com', password: 'whatever' })
      .expect(401)
      .expect((res) => expect(res.body.code).toBe('INVALID_CREDENTIALS'));

    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'staff.login.failure' } });
    expect(audit).toBeTruthy();
    expect(audit!.entityId).toBeNull();
    expect((audit!.metadata as { attemptedEmail: string }).attemptedEmail).toBe('ghost@example.com');
  });

  it('password reset request + confirm round trip; writes a notification_log row; revokes refresh sessions', async () => {
    // Pre-existing refresh session that must be revoked by the reset confirm.
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);

    const oldCookie = toCookieList(login.headers['set-cookie']).find((c) =>
      c.startsWith(STAFF_COOKIE),
    )!;
    const cookieValue = `${STAFF_COOKIE}=${oldCookie.split(';')[0]!.split('=')[1]}`;

    await request(h.baseUrl)
      .post('/auth/staff/password-reset/request')
      .send({ email: staff.email })
      .expect(200)
      .expect((res) => expect(res.body.message).toMatch(/If an account exists/));

    // Wait for the BullMQ worker to drain the job and write the log row
    // (status SENT, dev-mode no provider id).
    const log = await waitFor(
      () =>
        h.prisma.notificationLog.findFirst({
          where: { templateCode: 'staff.password_reset.email' },
        }),
      { description: 'staff password-reset notification_log' },
    );
    expect(log.status).toBe('SENT');
    expect(log.toEmail).toBe(staff.email);
    expect(log.body).toContain('reset-password?token=');

    const plaintext = /token=([A-Za-z0-9_-]+)/.exec(log.body)![1]!;

    // Now confirm with the token.
    await request(h.baseUrl)
      .post('/auth/staff/password-reset/confirm')
      .send({ token: plaintext, newPassword: 'BrandNew-Password!42' })
      .expect(200)
      .expect((res) => expect(res.body.ok).toBe(true));

    // Old refresh cookie must be dead (refresh confirm revokes all sessions).
    await request(h.baseUrl).post('/auth/staff/refresh').set('Cookie', cookieValue).expect(401);

    // New password works.
    await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: 'BrandNew-Password!42' })
      .expect(200);
  });

  it('email verification request + confirm round trip sets emailVerifiedAt', async () => {
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);

    await request(h.baseUrl)
      .post('/auth/staff/email-verification/request')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    const log = await waitFor(
      () =>
        h.prisma.notificationLog.findFirst({
          where: { templateCode: 'staff.email_verification.email' },
        }),
      { description: 'staff email-verification notification_log' },
    );
    const plaintext = /token=([A-Za-z0-9_-]+)/.exec(log.body)![1]!;

    await request(h.baseUrl)
      .post('/auth/staff/email-verification/confirm')
      .send({ token: plaintext })
      .expect(200);

    const fresh = await h.prisma.staffUser.findUnique({ where: { id: staff.id } });
    expect(fresh!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rate limit: 5 failed logins → 6th returns 429 with Retry-After', async () => {
    const payload = { email: staff.email, password: 'WRONG' };

    for (let i = 1; i <= 5; i += 1) {
      await request(h.baseUrl).post('/auth/staff/login').send(payload).expect(401);
    }

    await request(h.baseUrl)
      .post('/auth/staff/login')
      .send(payload)
      .expect(429)
      .expect((res) => {
        expect(res.headers['retry-after']).toBeDefined();
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      });

    // Different email → different bucket → not throttled.
    await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: 'other@example.com', password: 'WRONG' })
      .expect(401);
  });
});
