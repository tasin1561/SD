import type { Redis as IORedisClient } from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import {
  ActorType,
  SellerStatus,
  StaffRoleKey,
  StoreExpenseCategory,
  type StaffRoleKeyValue,
} from '@skydrop/db';
import { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { EmailDispatchInput } from '../../src/modules/email/email.types';
import { IMPERSONATION_COOKIE } from '../../src/common/impersonation/impersonation-cookie';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Support impersonation, driven whole — the only test that does.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────
 * This feature is eight moving parts built against written contracts:
 * the admin surface that opens a session, the emailed second factor, the
 * handoff token, the two exchange endpoints that mint the cookie, the
 * middleware that opens the ambient context, the guard that refuses, the
 * two JWT guards that resolve WHOSE account this is, and the single
 * audit writer that stamps both identities onto every row. Every one of
 * them is unit-tested in isolation and every one of those tests passes.
 * None of them had ever been connected to the one next to it.
 *
 * A contract between two mocks is not a contract. The unit specs prove
 * `AuditLogService` stamps `impersonatedByStaffUserId` when a context is
 * ambient; they cannot prove a context IS ambient by the time a real
 * seller controller writes a real row, because the thing that opens it
 * is express middleware and the thing that reads it is an
 * `AsyncLocalStorage` four awaits and one Prisma transaction away. That
 * is exactly the failure the middleware's own docblock calls "the single
 * worst outcome available in this build": every row would say the seller
 * acted alone, silently, into an append-only table.
 *
 * ── WHAT GOES WRONG WITHOUT IT ───────────────────────────────────────
 * Six months after a support engineer places an order inside somebody's
 * account, the seller says they never placed it. `audit_logs` is the
 * only evidence that will ever exist, it cannot be corrected, and if it
 * names the wrong person it is worse than no row at all — it is evidence
 * against somebody who did nothing. That assertion (`actorType =
 * STAFF_AS_SELLER`, `impersonatedByStaffUserId` = the staff member,
 * `actorId` still the seller) is the most important one in this file,
 * and it is made against the DATABASE rather than a response body
 * because the response body is not what anybody will read.
 *
 * The second reason is the deny list. Until today it named
 * `/seller/webhooks` and `/seller/withdrawals`, which are not routes
 * anybody serves — `startsWith` on a prefix that matches nothing refuses
 * nothing and says nothing, so eight live routes in the two categories
 * the list exists to close were reachable with `mayWrite: true`. The
 * source test that found it scans controllers. This one drives the REAL
 * routes, because a prefix can be right in the list and still be wrong
 * in the guard.
 *
 * ── HOW THE CODE IS OBTAINED ─────────────────────────────────────────
 * The OTP is mailed and never returned by any endpoint, which is the
 * design. The test reads it the way an interception would: a spy that
 * RECORDS `EmailQueue.enqueue` without replacing it, so the mail really
 * is enqueued and the code the test types is the code that was sent.
 * Nothing in `src/` is weakened to make this possible.
 */
describe('support impersonation (e2e)', () => {
  let h: AppHarness;
  let enqueueSpy: jest.SpyInstance<Promise<string>, [EmailDispatchInput, ...unknown[]]>;

  /** Custom staff roles — no SEEDED role grants `support.impersonate*`. */
  let roleIdImpersonateOnly: string;
  let roleIdImpersonateWrite: string;
  let roleIdReviewOnly: string;
  const customRoleIds: string[] = [];

  interface Staff {
    readonly id: string;
    readonly email: string;
    readonly auth: { Authorization: string };
  }

  /** The super admin: holds the whole catalogue, so all three keys. */
  let admin: Staff;

  interface Seller {
    readonly sellerId: string;
    readonly ownerUserId: string;
    readonly email: string;
    readonly companyName: string;
    readonly auth: { Authorization: string };
  }
  let seller: Seller;

  let reasonCounter = 0;

  beforeAll(async () => {
    h = await bootTestApp();
    // Recorded, NOT replaced: the real enqueue still runs, so what this
    // test reads is what was actually sent.
    enqueueSpy = jest.spyOn(
      h.app.get(EmailQueue, { strict: false }),
      'enqueue',
    ) as unknown as typeof enqueueSpy;

    roleIdImpersonateOnly = await makeStaffRole('read-only impersonator', ['support.impersonate']);
    roleIdImpersonateWrite = await makeStaffRole('writing impersonator', [
      'support.impersonate',
      'support.impersonate.write',
    ]);
    roleIdReviewOnly = await makeStaffRole('pure reviewer', ['support.impersonate.review']);
  });

  afterAll(async () => {
    enqueueSpy.mockRestore();
    // `staff_user_roles` RESTRICTS the role side, and the harness reset
    // does not touch `staff_roles` at all — so the assignments go first
    // and the roles this file invented go with it.
    await h.prisma.staffUserRoleAssignment.deleteMany({
      where: { roleId: { in: customRoleIds } },
    });
    await h.prisma.staffRoleDefinition.deleteMany({ where: { id: { in: customRoleIds } } });
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    enqueueSpy.mockClear();

    admin = await signInStaff({ seededRole: StaffRoleKey.SUPER_ADMIN });
    seller = await makeSeller('subject');
  });

  // ── fixtures ────────────────────────────────────────────────────────

  /**
   * A staff role with exactly these permission keys.
   *
   * Needed because NO seeded role grants `support.impersonate`: the three
   * keys are in the catalogue and in no migration, so a super admin holds
   * them only implicitly (`is_super_admin` grants everything). There is
   * therefore no stock role that holds the start permission and not the
   * write one, which is the pair half these cases are about.
   */
  async function makeStaffRole(label: string, permissions: string[]): Promise<string> {
    const role = await h.prisma.staffRoleDefinition.create({
      data: {
        key: `e2e-imp-${label.replace(/\W+/g, '-')}-${randomBytes(4).toString('hex')}`,
        name: `E2E ${label}`,
        description: 'Created by impersonation.e2e-spec; removed in afterAll.',
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
      select: { id: true },
    });
    customRoleIds.push(role.id);
    return role.id;
  }

  /** A signed-in staff member holding either a seeded role or a custom one. */
  async function signInStaff(
    which: { seededRole: StaffRoleKeyValue } | { roleId: string },
  ): Promise<Staff> {
    const staff = await createTestStaff(h.prisma, {
      // A seeded role is needed to create the row at all (the harness
      // looks one up); when a custom role is wanted the assignment is
      // REPLACED below, so the person holds only what the case is about.
      role: 'seededRole' in which ? which.seededRole : StaffRoleKey.READONLY,
    });
    if ('roleId' in which) {
      await h.prisma.staffUserRoleAssignment.deleteMany({ where: { staffUserId: staff.id } });
      await h.prisma.staffUserRoleAssignment.create({
        data: { staffUserId: staff.id, roleId: which.roleId },
      });
    }
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    return {
      id: staff.id,
      email: staff.email,
      auth: { Authorization: `Bearer ${login.body.accessToken}` },
    };
  }

  /** An APPROVED seller with its owner signed in — the support subject. */
  async function makeSeller(label: string): Promise<Seller> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@imp.test`;
    const companyName = `${label} Trading ${Math.random().toString(36).slice(2, 7)}`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(admin.auth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName,
        contactPersonName: `${label} Owner`,
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);
    const sellerId = reg.body.seller.id as string;
    await h.prisma.seller.update({
      where: { id: sellerId },
      data: { status: SellerStatus.APPROVED },
    });
    // The person a SELLER session resolves to: the oldest live owner.
    const owner = await h.prisma.sellerUser.findFirstOrThrow({
      where: { sellerId, deletedAt: null, roles: { some: { role: { isOwner: true } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const login = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);
    return {
      sellerId,
      ownerUserId: owner.id,
      email: email.toLowerCase(),
      companyName,
      auth: { Authorization: `Bearer ${login.body.accessToken}` },
    };
  }

  /** A reseller store of `seller`, with its owner store user created. */
  async function makeStore(label: string): Promise<{ storeId: string; ownerUserId: string }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(seller.auth)
      .send({
        name: `${label} ${Math.random().toString(36).slice(2, 8)}`,
        displayName: `${label} Shopfront`,
        contactEmail: email,
        contactPhone: '+919800000004',
        invite: { email, fullName: `${label} Owner`, roleKeys: ['owner'] },
      })
      .expect(201);
    const storeId = created.body.id as string;

    // The invitation token is stored as a SHA-256 and mailed in
    // plaintext; the same substitution the reseller specs use is the
    // shortest honest way to accept one from a test.
    const invitation = await h.prisma.storeUserInvitation.findFirstOrThrow({
      where: { storeId, usedAt: null, deletedAt: null },
      select: { id: true },
    });
    const plaintext = `e2e-invite-${randomBytes(24).toString('hex')}`;
    await h.prisma.storeUserInvitation.update({
      where: { id: invitation.id },
      data: { token: createHash('sha256').update(plaintext, 'utf8').digest('hex') },
    });
    await request(h.baseUrl)
      .post('/auth/store/invitations/accept')
      .send({ token: plaintext, password: 'StorePass-1234', fullName: `${label} Owner` })
      .expect(201);

    const owner = await h.prisma.storeUser.findFirstOrThrow({
      where: { storeId, deletedAt: null, roles: { some: { role: { isOwner: true } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return { storeId, ownerUserId: owner.id };
  }

  // ── the session, step by step ───────────────────────────────────────

  /** The Indian calendar day, which is what the expense book is keyed on. */
  function istToday(): string {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  /** A reason long enough to be a reason, and unique so its mail is findable. */
  function aReason(what: string): string {
    reasonCounter += 1;
    return `Looking into ${what} for this account, e2e case ${reasonCounter}`;
  }

  /**
   * The six digits that were mailed for this session's request.
   *
   * Matched on the REASON rather than on "the most recent mail": several
   * sessions are opened in some of these cases and typing the wrong
   * session's code would make a test pass or fail for a reason that has
   * nothing to do with what it is about.
   */
  function mailedCode(reason: string): string {
    const call = [...enqueueSpy.mock.calls]
      .reverse()
      .find(
        ([input]) =>
          input.templateCode === 'staff.impersonation_otp.email' &&
          input.variables?.['reason'] === reason,
      );
    if (call === undefined) {
      throw new Error(`no impersonation OTP mail was enqueued for reason "${reason}"`);
    }
    const code = call[0].variables?.['code'];
    if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
      throw new Error(`the OTP mail carried no six-digit code (got ${String(code)})`);
    }
    return code;
  }

  async function startSession(
    staff: Staff,
    body: {
      subjectKind: 'SELLER' | 'STORE';
      subjectId: string;
      reason: string;
      mayWrite?: boolean;
    },
  ): Promise<request.Response> {
    return request(h.baseUrl).post('/admin/impersonation/start').set(staff.auth).send(body);
  }

  /** start + verify, returning the session id and the one-shot handoff token. */
  async function verifiedSession(
    staff: Staff,
    subject: { kind: 'SELLER' | 'STORE'; id: string },
    opts: { mayWrite?: boolean; reason?: string } = {},
  ): Promise<{ sessionId: string; token: string; reason: string }> {
    const reason =
      opts.reason ?? aReason(`${subject.kind.toLowerCase()} ${subject.id.slice(0, 8)}`);
    const started = await startSession(staff, {
      subjectKind: subject.kind,
      subjectId: subject.id,
      reason,
      ...(opts.mayWrite === undefined ? {} : { mayWrite: opts.mayWrite }),
    });
    expect(started.status).toBe(201);
    const sessionId = started.body.sessionId as string;

    const verified = await request(h.baseUrl)
      .post(`/admin/impersonation/${sessionId}/verify`)
      .set(staff.auth)
      .send({ code: mailedCode(reason) });
    expect(verified.status).toBe(200);
    return { sessionId, token: verified.body.handoff.token as string, reason };
  }

  /** The `__Host-impersonation` cookie a successful exchange set. */
  function cookieFrom(res: request.Response): string {
    const jar = (res.headers['set-cookie'] ?? []) as unknown as string[];
    const hit = jar.find((c) => c.startsWith(`${IMPERSONATION_COOKIE}=`));
    if (hit === undefined) {
      throw new Error(
        `the exchange set no ${IMPERSONATION_COOKIE} cookie (headers: ${JSON.stringify(jar)})`,
      );
    }
    return hit.split(';')[0]!;
  }

  /** Walk the whole way in and come back holding the session cookie. */
  async function enter(
    staff: Staff,
    subject: { kind: 'SELLER' | 'STORE'; id: string },
    opts: { mayWrite?: boolean } = {},
  ): Promise<{ sessionId: string; cookie: string }> {
    const { sessionId, token } = await verifiedSession(staff, subject, opts);
    const origin = subject.kind === 'SELLER' ? 'seller' : 'store';
    const exchanged = await request(h.baseUrl)
      .post(`/auth/${origin}/impersonation/exchange`)
      .send({ handoffToken: token });
    expect(exchanged.status).toBe(200);
    return { sessionId, cookie: cookieFrom(exchanged) };
  }

  async function withRedis<T>(fn: (r: IORedisClient) => Promise<T>): Promise<T> {
    const { default: IORedis } = await import('ioredis');
    const r = new IORedis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379/1', {
      maxRetriesPerRequest: null,
    });
    try {
      return await fn(r);
    } finally {
      await r.quit();
    }
  }

  // ── 1. the happy path, whole ─────────────────────────────────────────

  describe('the whole way in', () => {
    /**
     * Nothing in this build had ever run start → mail → verify →
     * handoff → exchange → cookie → a request that comes back with the
     * subject's own data. Each hop is a different module and three of
     * them were written against an assumption about the hop before.
     */
    it('starts, verifies with the mailed code, exchanges, and reads THAT seller’s data', async () => {
      const reason = aReason('a payout that does not reconcile');
      const started = await startSession(admin, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason,
      });
      expect(started.status).toBe(201);
      // The code goes to the STAFF member's own inbox, never to the
      // seller's — asking the account holder to read a code out would
      // teach them to do exactly that for the next caller who asks.
      expect(started.body.otpSentTo).toBe(admin.email);
      // And no endpoint hands the code back: an id and two deadlines,
      // nothing that can be polled for the secret.
      expect(Object.keys(started.body).sort()).toEqual([
        'expiresAt',
        'otpExpiresAt',
        'otpSentTo',
        'sessionId',
      ]);

      // The row exists and grants nothing yet.
      const beforeVerify = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: started.body.sessionId as string },
      });
      expect(beforeVerify.otpVerifiedAt).toBeNull();
      expect(beforeVerify.sellerId).toBe(seller.sellerId);
      expect(beforeVerify.reason).toBe(reason);

      const verified = await request(h.baseUrl)
        .post(`/admin/impersonation/${started.body.sessionId}/verify`)
        .set(admin.auth)
        .send({ code: mailedCode(reason) })
        .expect(200);
      expect(verified.body.handoff.token).toEqual(expect.any(String));
      // The token travels in the FRAGMENT so it cannot reach a log.
      expect(verified.body.handoff.redirectUrl).toContain('#token=');

      const exchanged = await request(h.baseUrl)
        .post('/auth/seller/impersonation/exchange')
        .send({ handoffToken: verified.body.handoff.token })
        .expect(200);
      expect(exchanged.body).toMatchObject({
        sessionId: started.body.sessionId,
        subject: { kind: 'SELLER', id: seller.sellerId },
        mayWrite: false,
        reason,
      });
      const cookie = cookieFrom(exchanged);

      // And now the whole point: a seller endpoint, with no seller
      // credential anywhere, answering with the subject's own account.
      const profile = await request(h.baseUrl)
        .get('/seller/profile')
        .set('Cookie', cookie)
        .expect(200);
      expect(profile.body.email).toBe(seller.email);
      expect(profile.body.companyName).toBe(seller.companyName);
    });
  });

  // ── 2. the audit is right ───────────────────────────────────────────

  describe('the audit row names both halves', () => {
    /**
     * THE assertion this file exists for. `actorId` stays the seller
     * because the action really did happen in their account; the staff
     * member is named beside it because somebody has to be able to say
     * who was at the keyboard. Both, in one row, or the row is evidence
     * against the wrong person and cannot be corrected.
     */
    it('a seller action inside the session is STAFF_AS_SELLER, by that staff member, as that seller', async () => {
      const { cookie } = await enter(
        admin,
        { kind: 'SELLER', id: seller.sellerId },
        { mayWrite: true },
      );

      const created = await request(h.baseUrl)
        .post('/seller/stores')
        .set('Cookie', cookie)
        .send({ name: `Shopfront ${Math.random().toString(36).slice(2, 8)}` })
        .expect(201);

      const row = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'seller.store.created', entityId: created.body.id as string },
      });
      // Who was at the keyboard.
      expect(row.impersonatedByStaffUserId).toBe(admin.id);
      // Whose account it happened in — unchanged, and that is deliberate.
      expect(row.actorId).toBe(seller.ownerUserId);
      expect(row.sellerId).toBe(seller.sellerId);
      // And the row SAYS which kind of event it was rather than leaving
      // it to be inferred from a column being populated.
      expect(row.actorType).toBe(ActorType.STAFF_AS_SELLER);
    });

    it('a store action inside a STORE session is STAFF_AS_STORE, with the store user as actorId', async () => {
      const store = await makeStore('audited');
      const { cookie } = await enter(
        admin,
        { kind: 'STORE', id: store.storeId },
        { mayWrite: true },
      );

      const recorded = await request(h.baseUrl)
        .post('/store/expenses')
        .set('Cookie', cookie)
        .send({
          category: StoreExpenseCategory.AD_SPEND,
          amountInr: '1250.00',
          // TODAY: the store's books begin the month it was opened, and
          // this store was opened a moment ago.
          expenseDate: istToday(),
          description: 'Support session expense, recorded by e2e',
        })
        .expect(201);

      const row = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'store.expense.recorded', entityId: recorded.body.id as string },
      });
      expect(row.actorType).toBe(ActorType.STAFF_AS_STORE);
      expect(row.impersonatedByStaffUserId).toBe(admin.id);
      expect(row.actorId).toBe(store.ownerUserId);
    });

    /**
     * The seller's OWN request must be untouched by all of this. A
     * change that stamped the ordinary path would be a far bigger
     * incident than one that missed the rare path.
     */
    it('the seller acting alone is still a plain SELLER row with no impersonator', async () => {
      const created = await request(h.baseUrl)
        .post('/seller/stores')
        .set(seller.auth)
        .send({ name: `Own shopfront ${Math.random().toString(36).slice(2, 8)}` })
        .expect(201);

      const row = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'seller.store.created', entityId: created.body.id as string },
      });
      expect(row.actorType).toBe(ActorType.SELLER);
      expect(row.impersonatedByStaffUserId).toBeNull();
    });
  });

  // ── 3 + 5. read-only refuses; write is allowed ──────────────────────

  describe('read-only means read-only', () => {
    it('refuses an ordinary seller POST, in a sentence about their account', async () => {
      const { sessionId, cookie } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });

      const refused = await request(h.baseUrl)
        .post('/seller/stores')
        .set('Cookie', cookie)
        .send({ name: 'Should never exist' });

      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('FORBIDDEN_WHILE_IMPERSONATING');
      expect(refused.body.message).toBe(
        'This is a read-only support session. Nothing in their account can be changed from it.',
      );
      // Nothing was created, and the refusal is itself on the record.
      expect(
        await h.prisma.sellerStore.count({
          where: { sellerId: seller.sellerId, name: 'Should never exist' },
        }),
      ).toBe(0);
      const refusalRow = await h.prisma.auditLog.findFirstOrThrow({
        where: { action: 'impersonation.request_refused', entityId: sessionId },
      });
      expect(refusalRow.actorType).toBe(ActorType.STAFF_AS_SELLER);
      expect(refusalRow.impersonatedByStaffUserId).toBe(admin.id);
    });

    it('still reads, because reading is the whole point of a read-only session', async () => {
      const { cookie } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });
      const profile = await request(h.baseUrl)
        .get('/seller/profile')
        .set('Cookie', cookie)
        .expect(200);
      expect(profile.body.email).toBe(seller.email);
    });
  });

  describe('a write session can actually do the job', () => {
    /**
     * The other half of a refusal test, and the half that is usually
     * missing: a feature that refuses everything passes every negative
     * case and is useless.
     */
    it('allows an ordinary mutation and really writes it', async () => {
      const { sessionId, cookie } = await enter(
        admin,
        { kind: 'SELLER', id: seller.sellerId },
        { mayWrite: true },
      );
      const name = `Allowed shopfront ${Math.random().toString(36).slice(2, 8)}`;

      const created = await request(h.baseUrl)
        .post('/seller/stores')
        .set('Cookie', cookie)
        .send({ name })
        .expect(201);

      expect(
        await h.prisma.sellerStore.findFirst({
          where: { id: created.body.id as string, sellerId: seller.sellerId },
          select: { name: true },
        }),
      ).toEqual({ name });
      // And the session's counters know it happened — the review screen's
      // sort key, which is the only reason they exist.
      const row = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { requestCount: true, writeCount: true },
      });
      expect(row.writeCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 4. the forbidden list, with mayWrite: true ──────────────────────

  describe('the forbidden list holds even with write access', () => {
    /**
     * These five are the ones that were WRONGLY ALLOWED until today: the
     * list said `/seller/webhooks` and `/seller/withdrawals`, which
     * nothing serves, and never named `/seller/roles` or
     * `/store/wallet/withdrawals` in any spelling. A prefix that matches
     * no route refuses nothing and reports nothing, so the only test
     * that can prove the fix is one that posts to the route a browser
     * would post to. Every one of them creates either lasting access or
     * movement of somebody else's money, and an audit row undoes
     * neither.
     */
    const SELLER_FORBIDDEN: ReadonlyArray<{ path: string; body: Record<string, unknown> }> = [
      {
        path: '/seller/webhook-endpoints',
        body: { url: 'https://example.test/hook', events: ['order.created'] },
      },
      { path: '/seller/wallet/withdrawal-requests', body: { amountInr: '100.00' } },
      { path: '/seller/roles', body: { name: 'Snoop', permissions: [] } },
      { path: '/seller/team/invitations', body: { email: 'nope@example.test', roleKeys: ['ops'] } },
    ];

    it.each(SELLER_FORBIDDEN)('refuses POST $path', async ({ path, body }) => {
      const { cookie } = await enter(
        admin,
        { kind: 'SELLER', id: seller.sellerId },
        { mayWrite: true },
      );

      const res = await request(h.baseUrl).post(path).set('Cookie', cookie).send(body);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_WHILE_IMPERSONATING');
      // The sentence explains it in terms of their account, not our rules.
      expect(String(res.body.message).length).toBeGreaterThan(20);
    });

    it('refuses POST /store/wallet/withdrawals', async () => {
      const store = await makeStore('money');
      const { cookie } = await enter(
        admin,
        { kind: 'STORE', id: store.storeId },
        { mayWrite: true },
      );

      const res = await request(h.baseUrl)
        .post('/store/wallet/withdrawals')
        .set('Cookie', cookie)
        .send({ amountInr: '100.00' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_WHILE_IMPERSONATING');
      expect(res.body.message).toBe('Moving their money out is never a support action.');
    });

    /**
     * Refused BEFORE the handler, before the pipes, and before the
     * seller's own authentication would have been consulted — so a
     * malformed body cannot turn a 403 into a 400 and hide the fact that
     * the route was reachable at all.
     */
    it('refuses a forbidden route even with a body that would not validate', async () => {
      const { cookie } = await enter(
        admin,
        { kind: 'SELLER', id: seller.sellerId },
        { mayWrite: true },
      );
      const res = await request(h.baseUrl)
        .post('/seller/api-keys')
        .set('Cookie', cookie)
        .send({ nonsense: true });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_WHILE_IMPERSONATING');
    });
  });

  // ── 6. boundaries ───────────────────────────────────────────────────

  describe('boundaries', () => {
    it('a handoff token is single-use — the second exchange is refused', async () => {
      const { token } = await verifiedSession(admin, { kind: 'SELLER', id: seller.sellerId });

      await request(h.baseUrl)
        .post('/auth/seller/impersonation/exchange')
        .send({ handoffToken: token })
        .expect(200);

      const second = await request(h.baseUrl)
        .post('/auth/seller/impersonation/exchange')
        .send({ handoffToken: token });
      expect(second.status).toBe(401);
      expect(second.body.code).toBe('IMPERSONATION_HANDOFF_INVALID');
    });

    it('a SELLER token is refused at the store origin, and a STORE token at the seller origin', async () => {
      const store = await makeStore('origins');
      const sellerSide = await verifiedSession(admin, { kind: 'SELLER', id: seller.sellerId });
      const storeSide = await verifiedSession(admin, { kind: 'STORE', id: store.storeId });

      const atStore = await request(h.baseUrl)
        .post('/auth/store/impersonation/exchange')
        .send({ handoffToken: sellerSide.token });
      expect(atStore.status).toBe(401);
      expect(atStore.body.code).toBe('IMPERSONATION_HANDOFF_INVALID');

      const atSeller = await request(h.baseUrl)
        .post('/auth/seller/impersonation/exchange')
        .send({ handoffToken: storeSide.token });
      expect(atSeller.status).toBe(401);
      expect(atSeller.body.code).toBe('IMPERSONATION_HANDOFF_INVALID');

      // And the mistake SPENT both tokens: presenting one at the right
      // origin afterwards must not work either, or a wrong-origin probe
      // would be free.
      const retry = await request(h.baseUrl)
        .post('/auth/seller/impersonation/exchange')
        .send({ handoffToken: sellerSide.token });
      expect(retry.status).toBe(401);
    });

    it('an ended session’s cookie is refused on the very next request', async () => {
      const { sessionId, cookie } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });
      await request(h.baseUrl).get('/seller/profile').set('Cookie', cookie).expect(200);

      await request(h.baseUrl)
        .post(`/admin/impersonation/${sessionId}/end`)
        .set(admin.auth)
        .send({ reason: 'Finished looking' })
        .expect(200);

      const after = await request(h.baseUrl).get('/seller/profile').set('Cookie', cookie);
      expect(after.status).toBe(401);
      expect(after.body.code).toBe('IMPERSONATION_SESSION_ENDED');
      expect(after.body.message).toContain('Finished looking');
    });

    /**
     * There is no endpoint that will hand out a handoff token for an
     * unverified session — that is the design. So the token is planted
     * in Redis directly, which is the only way to put the question to
     * the exchange endpoint at all: given a perfectly good token, does
     * the ROW still have to be verified? The session service's own
     * docblock says the OTP clause is the one a second copy of the check
     * would drop, because an unverified row looks completely normal.
     */
    it('a session whose code was never entered cannot be exchanged, even holding a valid token', async () => {
      const reason = aReason('a session nobody confirmed');
      const started = await startSession(admin, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason,
      });
      expect(started.status).toBe(201);
      const sessionId = started.body.sessionId as string;

      const token = `e2e-${randomBytes(32).toString('hex')}`;
      await withRedis((r) =>
        r.set(
          `impersonation:handoff:${createHash('sha256').update(token, 'utf8').digest('hex')}`,
          sessionId,
          'EX',
          60,
        ),
      );

      const res = await request(h.baseUrl)
        .post('/auth/seller/impersonation/exchange')
        .send({ handoffToken: token });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('IMPERSONATION_NOT_VERIFIED');
      // Nothing was handed out: no cookie, so no way in.
      expect(
        ((res.headers['set-cookie'] ?? []) as unknown as string[]).filter((c) =>
          c.startsWith(`${IMPERSONATION_COOKIE}=`),
        ),
      ).toEqual([]);
    });

    it('five wrong codes close the session, so the sixth guess has nothing to guess at', async () => {
      const reason = aReason('somebody guessing at a code');
      const started = await startSession(admin, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason,
      });
      expect(started.status).toBe(201);
      const sessionId = started.body.sessionId as string;
      const wrong = mailedCode(reason) === '000000' ? '111111' : '000000';

      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await request(h.baseUrl)
          .post(`/admin/impersonation/${sessionId}/verify`)
          .set(admin.auth)
          .send({ code: wrong });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401]);

      const row = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { endedAt: true, endedReason: true, otpVerifiedAt: true },
      });
      expect(row.endedAt).not.toBeNull();
      expect(row.endedReason).toBe('OTP attempts exhausted');
      expect(row.otpVerifiedAt).toBeNull();

      // And the REAL code is dead with it.
      const tooLate = await request(h.baseUrl)
        .post(`/admin/impersonation/${sessionId}/verify`)
        .set(admin.auth)
        .send({ code: mailedCode(reason) });
      expect(tooLate.status).toBe(400);
      expect(tooLate.body.code).toBe('IMPERSONATION_SESSION_ENDED');
    });

    it('a reason too short to review is refused before any row exists', async () => {
      const res = await startSession(admin, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason: 'checking',
      });
      expect(res.status).toBe(400);
      expect(await h.prisma.impersonationSession.count()).toBe(0);
    });
  });

  // ── 7. permissions ──────────────────────────────────────────────────

  describe('permissions', () => {
    it('without support.impersonate, a session cannot be started at all', async () => {
      // Read-only is the seeded tier that sees everything and changes
      // nothing, and it holds no impersonation key — nor does any other
      // seeded role (see `makeStaffRole`).
      const outsider = await signInStaff({ seededRole: StaffRoleKey.READONLY });

      const res = await startSession(outsider, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason: aReason('an account they may not enter'),
      });
      expect(res.status).toBe(403);
      expect(await h.prisma.impersonationSession.count()).toBe(0);
    });

    it('without support.impersonate.write, a write session is refused and a read one is offered', async () => {
      const reader = await signInStaff({ roleId: roleIdImpersonateOnly });

      const refused = await startSession(reader, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason: aReason('a payout, read-only'),
        mayWrite: true,
      });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toContain('read-only session');
      // Refused BEFORE a row was written: a request that granted nothing
      // should not leave a session in the review claiming write access.
      expect(await h.prisma.impersonationSession.count()).toBe(0);

      const allowed = await startSession(reader, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason: aReason('the same payout, looking only'),
      });
      expect(allowed.status).toBe(201);
    });

    it('with support.impersonate.write, the write session is granted', async () => {
      const writer = await signInStaff({ roleId: roleIdImpersonateWrite });
      const res = await startSession(writer, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason: aReason('an order that has to be edited'),
        mayWrite: true,
      });
      expect(res.status).toBe(201);
      const row = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: res.body.sessionId as string },
        select: { mayWrite: true, staffUserId: true },
      });
      expect(row).toEqual({ mayWrite: true, staffUserId: writer.id });
    });

    it('without support.impersonate.review, the review screens are closed', async () => {
      const operator = await signInStaff({ roleId: roleIdImpersonateOnly });
      await request(h.baseUrl).get('/admin/impersonation').set(operator.auth).expect(403);
      await request(h.baseUrl).get('/admin/impersonation/active').set(operator.auth).expect(403);
    });

    it('a reviewer sees the session and can stop it without holding the start permission', async () => {
      const reviewer = await signInStaff({ roleId: roleIdReviewOnly });
      const { sessionId, cookie } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });

      const active = await request(h.baseUrl)
        .get('/admin/impersonation/active')
        .set(reviewer.auth)
        .expect(200);
      expect((active.body as Array<{ id: string }>).map((s) => s.id)).toContain(sessionId);

      const listed = await request(h.baseUrl)
        .get('/admin/impersonation')
        .set(reviewer.auth)
        .expect(200);
      expect((listed.body as Array<{ id: string }>).map((s) => s.id)).toContain(sessionId);

      // The route is open to `.review` alone — a pure reviewer who could
      // see a live session and not end it would leave the oversight
      // screen with no action on it.
      await request(h.baseUrl)
        .post(`/admin/impersonation/${sessionId}/end`)
        .set(reviewer.auth)
        .send({ reason: 'Stopped by the reviewer' })
        .expect(200);

      const after = await request(h.baseUrl).get('/seller/profile').set('Cookie', cookie);
      expect(after.status).toBe(401);
    });

    it('somebody else’s unverified session is NOT FOUND, not forbidden', async () => {
      // A distinguishable "exists but is not yours" would let anybody
      // with the start permission sweep for live session ids.
      const other = await signInStaff({ roleId: roleIdImpersonateOnly });
      const reason = aReason('a session that belongs to the admin');
      const started = await startSession(admin, {
        subjectKind: 'SELLER',
        subjectId: seller.sellerId,
        reason,
      });
      expect(started.status).toBe(201);

      const res = await request(h.baseUrl)
        .post(`/admin/impersonation/${started.body.sessionId}/verify`)
        .set(other.auth)
        .send({ code: mailedCode(reason) });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('IMPERSONATION_SESSION_NOT_FOUND');
    });
  });

  // ── 8. ending, from both ends ───────────────────────────────────────

  describe('ending works from both ends', () => {
    it('the admin route sets endedAt and names who closed it', async () => {
      const { sessionId } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });

      const ended = await request(h.baseUrl)
        .post(`/admin/impersonation/${sessionId}/end`)
        .set(admin.auth)
        .send({ reason: 'Done with the payout' })
        .expect(200);
      expect(ended.body.live).toBe(false);

      const row = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { endedAt: true, endedReason: true },
      });
      expect(row.endedAt).not.toBeNull();
      expect(row.endedReason).toBe('Done with the payout');
    });

    it('the from-inside route ends it for real and drops the cookie', async () => {
      const { sessionId, cookie } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });

      const res = await request(h.baseUrl)
        .post('/auth/seller/impersonation/end')
        .set('Cookie', cookie)
        .expect(204);
      // The cookie is cleared in the same response.
      expect(((res.headers['set-cookie'] ?? []) as unknown as string[]).join(';')).toContain(
        IMPERSONATION_COOKIE,
      );

      const row = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { endedAt: true, endedReason: true },
      });
      expect(row.endedAt).not.toBeNull();
      expect(row.endedReason).toBe('Ended from inside the account');

      // And the cookie is dead even if the browser kept it.
      const after = await request(h.baseUrl).get('/seller/profile').set('Cookie', cookie);
      expect(after.status).toBe(401);
    });

    /**
     * `leave` and `end` are easy to confuse and only one of them is
     * visible to a reviewer. A review screen listing sessions nobody is
     * in any more is a review screen people stop trusting — and the
     * other way round, a `leave` that quietly ended things would make
     * "forgot a cookie" and "closed the session" the same fact.
     */
    it('leave drops the cookie only — the session is still live', async () => {
      const { sessionId, cookie } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });

      await request(h.baseUrl)
        .post('/auth/seller/impersonation/leave')
        .set('Cookie', cookie)
        .expect(204);

      const row = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { endedAt: true },
      });
      expect(row.endedAt).toBeNull();
      // The browser forgot it; the server did not. A client that kept the
      // cookie is still inside, which is exactly what `end` is for.
      await request(h.baseUrl).get('/seller/profile').set('Cookie', cookie).expect(200);
    });

    it('ending twice keeps the first endedAt — two people pressing stop is the expected way', async () => {
      const { sessionId } = await enter(admin, { kind: 'SELLER', id: seller.sellerId });
      const first = await request(h.baseUrl)
        .post(`/admin/impersonation/${sessionId}/end`)
        .set(admin.auth)
        .send({ reason: 'The first ending' })
        .expect(200);

      await request(h.baseUrl)
        .post(`/admin/impersonation/${sessionId}/end`)
        .set(admin.auth)
        .send({ reason: 'A second press' })
        .expect(200);

      const row = await h.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { endedAt: true, endedReason: true },
      });
      expect(row.endedReason).toBe('The first ending');
      expect(row.endedAt?.toISOString()).toBe(new Date(first.body.endedAt as string).toISOString());
    });
  });
});
