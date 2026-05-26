import request from 'supertest';
import { SellerStatus } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

const SELLER_COOKIE = '__Host-sellerRefresh';

function toCookieList(header: string | string[] | undefined): string[] {
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

describe('Seller flow (e2e): invitation → register → login → api keys → status recheck', () => {
  let h: AppHarness;
  let staffAccess: string;
  let inviteEmail: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma);
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAccess = login.body.accessToken as string;
    inviteEmail = `invitee-${Date.now()}@brand.com`;
  });

  it('full invitation lifecycle: admin creates → list shows pending → seller registers → audit trail', async () => {
    const created = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ email: inviteEmail })
      .expect(201);

    expect(created.body.email).toBe(inviteEmail);
    expect(created.body.status).toBe('pending');
    expect(created.body.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.body.inviteUrl).toContain(created.body.token);

    const list = await request(h.baseUrl)
      .get('/admin/seller-invitations?status=pending&limit=10')
      .set('Authorization', `Bearer ${staffAccess}`)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].email).toBe(inviteEmail);

    // Now register as the seller.
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: created.body.token,
        companyName: 'Brand Co',
        contactPersonName: 'Sara Khan',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);

    expect(reg.body.accessToken).toBeDefined();
    expect(reg.body.seller.status).toBe('APPROVED');

    // Invitation now marked used + linked to the new seller.
    const inv = await h.prisma.sellerInvitation.findUnique({ where: { id: created.body.id } });
    expect(inv!.usedAt).toBeInstanceOf(Date);
    expect(inv!.sellerId).toBe(reg.body.seller.id);

    // Audit trail captured the registration.
    const audit = await h.prisma.auditLog.findFirst({
      where: { action: 'seller.registered_via_invitation' },
    });
    expect(audit).toBeTruthy();

    // /auth/seller/me returns the seller profile.
    const me = await request(h.baseUrl)
      .get('/auth/seller/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);
    expect(me.body.companyName).toBe('Brand Co');
    expect(me.body.status).toBe('APPROVED');

    // Re-using the invitation token must fail.
    await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: created.body.token,
        companyName: 'X',
        contactPersonName: 'Y',
        phone: '+8801712345678',
        password: 'SecondTry-Password-1',
      })
      .expect(400);
  });

  it('seller login: APPROVED+SUSPENDED succeed; PENDING/REJECTED return 403; /me still gates by APPROVED', async () => {
    // Quick path: create the seller directly so we can flip statuses.
    const created = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ email: inviteEmail })
      .expect(201);

    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: created.body.token,
        companyName: 'Brand Co',
        contactPersonName: 'Sara Khan',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);

    // Approved → login works.
    await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: inviteEmail, password: 'SellerPass-1234' })
      .expect(200);

    // Suspend → next /me 403 (default seller guard still rejects SUSPENDED;
    // read-only allow-suspended endpoints opt in via decorator).
    await h.prisma.seller.update({
      where: { id: reg.body.seller.id },
      data: { status: SellerStatus.SUSPENDED },
    });

    await request(h.baseUrl)
      .get('/auth/seller/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(403)
      .expect((res) => expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE'));

    // Login while SUSPENDED now succeeds (read-only access). Cookie is set.
    await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: inviteEmail, password: 'SellerPass-1234' })
      .expect(200);

    // Flip to PENDING — login must return 403.
    await h.prisma.seller.update({
      where: { id: reg.body.seller.id },
      data: { status: SellerStatus.PENDING },
    });
    await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: inviteEmail, password: 'SellerPass-1234' })
      .expect(403);

    // Flip to REJECTED — login must return 403.
    await h.prisma.seller.update({
      where: { id: reg.body.seller.id },
      data: { status: SellerStatus.REJECTED },
    });
    await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: inviteEmail, password: 'SellerPass-1234' })
      .expect(403);

    // Audit captured the SUSPENDED /me access denial earlier.
    const audit = await h.prisma.auditLog.findFirst({
      where: { action: 'seller.access_denied_status' },
    });
    expect(audit).toBeTruthy();
    expect((audit!.metadata as { status: string }).status).toBe(SellerStatus.SUSPENDED);
  });

  it('api key: create returns plaintext; revoke kills it; list never includes hash or plaintext', async () => {
    // Onboard a seller first.
    const created = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ email: inviteEmail })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: created.body.token,
        companyName: 'Brand Co',
        contactPersonName: 'Sara K',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);

    const create = await request(h.baseUrl)
      .post('/seller/api-keys')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ name: 'Production' })
      .expect(201);

    expect(create.body.plaintext).toMatch(/^skd_[A-Za-z0-9_-]+$/);
    expect(create.body.keyPrefix).toHaveLength(12);

    const list = await request(h.baseUrl)
      .get('/seller/api-keys')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].keyPrefix).toBe(create.body.keyPrefix);
    expect(list.body[0].keyHash).toBeUndefined();
    expect(list.body[0].plaintext).toBeUndefined();

    await request(h.baseUrl)
      .post(`/seller/api-keys/${create.body.id}/revoke`)
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(204);

    // Re-revoking → 400 ALREADY_REVOKED.
    await request(h.baseUrl)
      .post(`/seller/api-keys/${create.body.id}/revoke`)
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(400);
  });

  it('seller password reset round trip persists a notification_log and forces re-login', async () => {
    const created = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ email: inviteEmail })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: created.body.token,
        companyName: 'Brand Co',
        contactPersonName: 'Sara K',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);
    const oldCookieLine = toCookieList(reg.headers['set-cookie']).find((c) =>
      c.startsWith(SELLER_COOKIE),
    )!;
    const oldCookie = `${SELLER_COOKIE}=${oldCookieLine.split(';')[0]!.split('=')[1]}`;

    await request(h.baseUrl)
      .post('/auth/seller/password-reset/request')
      .send({ email: inviteEmail })
      .expect(200);

    const log = await waitFor(
      () =>
        h.prisma.notificationLog.findFirst({
          where: { templateCode: 'seller.password_reset.email' },
        }),
      { description: 'seller password-reset notification_log' },
    );
    const plaintext = /token=([A-Za-z0-9_-]+)/.exec(log.body)![1]!;

    await request(h.baseUrl)
      .post('/auth/seller/password-reset/confirm')
      .send({ token: plaintext, newPassword: 'Brand-New-Pass-100' })
      .expect(200);

    // Old refresh cookie must now be dead.
    await request(h.baseUrl).post('/auth/seller/refresh').set('Cookie', oldCookie).expect(401);

    // New password works.
    await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: inviteEmail, password: 'Brand-New-Pass-100' })
      .expect(200);
  });

  it('seller email verification round trip sets emailVerifiedAt', async () => {
    const created = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set('Authorization', `Bearer ${staffAccess}`)
      .send({ email: inviteEmail })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: created.body.token,
        companyName: 'Brand Co',
        contactPersonName: 'Sara K',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);

    await request(h.baseUrl)
      .post('/auth/seller/email-verification/request')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(200);

    const log = await waitFor(
      () =>
        h.prisma.notificationLog.findFirst({
          where: { templateCode: 'seller.email_verification.email' },
        }),
      { description: 'seller email-verification notification_log' },
    );
    const plaintext = /token=([A-Za-z0-9_-]+)/.exec(log.body)![1]!;

    await request(h.baseUrl)
      .post('/auth/seller/email-verification/confirm')
      .send({ token: plaintext })
      .expect(200);

    const fresh = await h.prisma.seller.findUnique({ where: { id: reg.body.seller.id } });
    expect(fresh!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Module 12 — hybrid bearer-OR-cookie /me for SSR-auth (Decision #1).
  // Mirrors the staff /me tests; adds the SUSPENDED 403 case because
  // the cookie path STILL re-runs the seller status check (preserving
  // the previous SellerJwtGuard semantics).
  // ─────────────────────────────────────────────────────────────────────

  describe('hybrid /me (Module 12 — bearer OR __Host-sellerRefresh cookie)', () => {
    async function registerSeller() {
      const created = await request(h.baseUrl)
        .post('/admin/seller-invitations')
        .set('Authorization', `Bearer ${staffAccess}`)
        .send({ email: inviteEmail })
        .expect(201);

      const reg = await request(h.baseUrl)
        .post('/auth/seller/register/invite')
        .send({
          token: created.body.token,
          companyName: 'Brand Co',
          contactPersonName: 'Sara Khan',
          phone: '+8801712345678',
          password: 'SellerPass-1234',
        })
        .expect(201);

      const cookieLine = toCookieList(reg.headers['set-cookie']).find((c) =>
        c.startsWith(SELLER_COOKIE),
      )!;
      const cookieValue = `${SELLER_COOKIE}=${cookieLine.split(';')[0]!.split('=')[1]}`;
      return {
        sellerId: reg.body.seller.id as string,
        accessToken: reg.body.accessToken as string,
        cookieValue,
      };
    }

    it('cookie path: returns identity for a valid __Host- cookie + NO rotation', async () => {
      const { cookieValue } = await registerSeller();
      const me = await request(h.baseUrl)
        .get('/auth/seller/me')
        .set('Cookie', cookieValue)
        .expect(200);
      expect(me.body.companyName).toBe('Brand Co');
      expect(me.body.status).toBe('APPROVED');
      expect(me.headers['set-cookie']).toBeUndefined();
    });

    it('cookie path is read-only: same cookie still works twice + no new refresh row created', async () => {
      const { sellerId, cookieValue } = await registerSeller();

      const before = await h.prisma.sellerRefreshToken.findFirst({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
      });
      expect(before!.revokedAt).toBeNull();

      await request(h.baseUrl).get('/auth/seller/me').set('Cookie', cookieValue).expect(200);
      await request(h.baseUrl).get('/auth/seller/me').set('Cookie', cookieValue).expect(200);

      const allRows = await h.prisma.sellerRefreshToken.findMany({ where: { sellerId } });
      expect(allRows).toHaveLength(1);
      expect(allRows[0]!.id).toBe(before!.id);
      expect(allRows[0]!.revokedAt).toBeNull();

      // The cookie still rotates successfully — confirms it was not
      // consumed by /me.
      await request(h.baseUrl)
        .post('/auth/seller/refresh')
        .set('Cookie', cookieValue)
        .expect(200);
    });

    it('cookie path does NOT trip reuse-detection on a revoked cookie', async () => {
      const { cookieValue: originalCookie } = await registerSeller();
      await request(h.baseUrl)
        .post('/auth/seller/refresh')
        .set('Cookie', originalCookie)
        .expect(200);

      const replayAuditBefore = await h.prisma.auditLog.findMany({
        where: { action: 'security.refresh_replay_detected' },
      });
      expect(replayAuditBefore).toHaveLength(0);

      await request(h.baseUrl)
        .get('/auth/seller/me')
        .set('Cookie', originalCookie)
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('UNAUTHORIZED'));

      const replayAuditAfter = await h.prisma.auditLog.findMany({
        where: { action: 'security.refresh_replay_detected' },
      });
      expect(replayAuditAfter).toHaveLength(0);
    });

    it('bearer wins; invalid bearer + valid cookie → 401, never falls through', async () => {
      const { cookieValue } = await registerSeller();
      await request(h.baseUrl)
        .get('/auth/seller/me')
        .set('Authorization', 'Bearer not-a-valid-jwt')
        .set('Cookie', cookieValue)
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('INVALID_TOKEN'));
    });

    it('cookie path still 403s a SUSPENDED seller (preserves the bearer-path semantic)', async () => {
      const { sellerId, cookieValue } = await registerSeller();
      // Flip to SUSPENDED.
      await h.prisma.seller.update({
        where: { id: sellerId },
        data: { status: SellerStatus.SUSPENDED },
      });

      await request(h.baseUrl)
        .get('/auth/seller/me')
        .set('Cookie', cookieValue)
        .expect(403)
        .expect((res) => expect(res.body.code).toBe('ACCOUNT_NOT_ACTIVE'));

      // Audit row written, severity MEDIUM, matches the SellerJwtGuard
      // pattern.
      const audit = await h.prisma.auditLog.findFirst({
        where: { action: 'seller.access_denied_status', sellerId },
      });
      expect(audit).toBeTruthy();
      expect((audit!.metadata as { status: string }).status).toBe('SUSPENDED');
    });

    it('no auth at all → 401', async () => {
      await request(h.baseUrl)
        .get('/auth/seller/me')
        .expect(401)
        .expect((res) => expect(res.body.code).toBe('UNAUTHORIZED'));
    });
  });
});
