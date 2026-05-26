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
    await resetAuthState(h.prisma, h.app);
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

  // ─────────────────────────────────────────────────────────────────────
  // Module 12 — hybrid bearer-OR-cookie /me for SSR-auth (Decision #1).
  // The cookie path MUST be read-only validation: no rotation, no
  // family-burn on revoked tokens (the family-burn is reserved for the
  // consumption path POST /refresh). This non-rotating property is the
  // load-bearing detail of the entire SSR-auth model — the admin
  // dashboard's server-component pages MUST be able to call /me with
  // ONLY the __Host- cookie and get an identity back, without rotating
  // the cookie underneath the browser's silent-refresh.
  // ─────────────────────────────────────────────────────────────────────

  describe('hybrid /me (Module 12 — bearer OR __Host-staffRefresh cookie)', () => {
    async function login() {
      const res = await request(h.baseUrl)
        .post('/auth/staff/login')
        .send({ email: staff.email, password: staff.password })
        .expect(200);
      const cookieLine = toCookieList(res.headers['set-cookie']).find((c) =>
        c.startsWith(STAFF_COOKIE),
      )!;
      const cookieValue = `${STAFF_COOKIE}=${cookieLine.split(';')[0]!.split('=')[1]}`;
      return { accessToken: res.body.accessToken as string, cookieValue };
    }

    it('bearer path: existing behavior unchanged (200, full identity)', async () => {
      const { accessToken } = await login();
      const me = await request(h.baseUrl)
        .get('/auth/staff/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.email).toBe(staff.email);
      expect(me.body.role).toBe('SUPER_ADMIN');
      // No Set-Cookie on a /me response — cookie path or bearer, /me
      // never rotates.
      expect(me.headers['set-cookie']).toBeUndefined();
    });

    it('cookie path: returns identity for a valid __Host- cookie + NO rotation (no Set-Cookie on response)', async () => {
      const { cookieValue } = await login();
      const me = await request(h.baseUrl)
        .get('/auth/staff/me')
        .set('Cookie', cookieValue)
        .expect(200);
      expect(me.body.email).toBe(staff.email);
      expect(me.body.role).toBe('SUPER_ADMIN');
      // Critical: the response carries NO Set-Cookie — the cookie was
      // not rotated.
      expect(me.headers['set-cookie']).toBeUndefined();
    });

    it('cookie path is read-only: same cookie still works twice + the underlying row is NOT rotated/revoked between calls', async () => {
      const { cookieValue } = await login();
      const tokenPlaintext = cookieValue.split('=')[1]!;

      // Snapshot the refresh row before any /me calls.
      const before = await h.prisma.staffRefreshToken.findFirst({
        where: { staffUserId: staff.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(before).toBeTruthy();
      expect(before!.revokedAt).toBeNull();

      // Call /me twice with the SAME cookie. Both must succeed.
      await request(h.baseUrl).get('/auth/staff/me').set('Cookie', cookieValue).expect(200);
      await request(h.baseUrl).get('/auth/staff/me').set('Cookie', cookieValue).expect(200);

      // The refresh row was not touched (no rotation): same id, same
      // tokenHash, still not revoked. Critically, NO new refresh row
      // was created (rotate() inserts a fresh row — we'd see two).
      const allRows = await h.prisma.staffRefreshToken.findMany({
        where: { staffUserId: staff.id },
      });
      expect(allRows).toHaveLength(1);
      expect(allRows[0]!.id).toBe(before!.id);
      expect(allRows[0]!.revokedAt).toBeNull();

      // And the cookie is STILL valid for a REAL rotate() call afterwards
      // — confirms the cookie was never consumed.
      const rotated = await request(h.baseUrl)
        .post('/auth/staff/refresh')
        .set('Cookie', cookieValue)
        .expect(200);
      expect(rotated.body.accessToken).toBeDefined();
      // Sanity: we used the right plaintext throughout (typed-flow check).
      expect(tokenPlaintext.length).toBeGreaterThan(0);
    });

    it('cookie path does NOT trip reuse-detection on a revoked cookie (returns 401 silently, no family-burn audit)', async () => {
      // Rotate FIRST so the original cookie is now revoked.
      const { cookieValue: originalCookie } = await login();
      await request(h.baseUrl)
        .post('/auth/staff/refresh')
        .set('Cookie', originalCookie)
        .expect(200);

      // No audit rows yet — clean baseline (legitimate rotate writes
      // 'staff.refresh.rotated', NOT the family-burn).
      const replayAuditBefore = await h.prisma.auditLog.findMany({
        where: { action: 'security.refresh_replay_detected' },
      });
      expect(replayAuditBefore).toHaveLength(0);

      // Present the now-revoked cookie to /me. Must 401, but must NOT
      // burn the family — this is validation, not consumption.
      await request(h.baseUrl)
        .get('/auth/staff/me')
        .set('Cookie', originalCookie)
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('UNAUTHORIZED'));

      // Critical assertion: no replay audit fired.
      const replayAuditAfter = await h.prisma.auditLog.findMany({
        where: { action: 'security.refresh_replay_detected' },
      });
      expect(replayAuditAfter).toHaveLength(0);

      // And the family is intact — the new (post-rotate) refresh row
      // is still ACTIVE. (revokedAt null on the most-recent row.)
      const activeRows = await h.prisma.staffRefreshToken.findMany({
        where: { staffUserId: staff.id, revokedAt: null },
      });
      expect(activeRows).toHaveLength(1);
    });

    it('bearer wins when both present; invalid bearer → 401 (does NOT silently fall through to cookie)', async () => {
      const { cookieValue } = await login();

      // Garbage bearer + valid cookie → 401, NOT 200 from cookie
      // fallthrough. Falling through would mask client bugs (stale
      // bearer silently elevating to a cookie-derived identity).
      await request(h.baseUrl)
        .get('/auth/staff/me')
        .set('Authorization', 'Bearer not-a-valid-jwt')
        .set('Cookie', cookieValue)
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('INVALID_TOKEN'));
    });

    it('no auth at all → 401', async () => {
      await request(h.baseUrl)
        .get('/auth/staff/me')
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('UNAUTHORIZED'));
    });
  });
});
