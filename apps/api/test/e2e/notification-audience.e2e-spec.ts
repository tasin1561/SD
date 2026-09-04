import request from 'supertest';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationSubjectType,
  NotificationSubscriptionMode,
  SellerStatus,
  StaffRole,
} from '@skydrop/db';
import { NotificationDispatchService } from '../../src/modules/notification-audience/services/notification-dispatch.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Notifications that address an AUDIENCE, on more than one channel.
 *
 * Unit tests can prove the policy table and the audience SQL. What they
 * cannot prove is the thing this system is actually made of: that a
 * person reading their own inbox gets THEIR rows and nobody else's,
 * that a broadcast reaching four thousand people is refused when the
 * population moved under it, and that a credential message physically
 * cannot land in an inbox however it is asked for. Each of those is a
 * property of the real endpoints, the real guard and the real unique
 * index, so each is tested here against a real database.
 *
 * The load-bearing one is CREDENTIAL. "Password reset goes to email
 * only" is a rule that a settings screen, a subscription row or a
 * badly-chosen channel list could each quietly break, and the failure
 * would be invisible — a reset link sitting in a shared inbox reads
 * exactly like a normal notification. So it is asserted three ways:
 * asked for in-app directly, asked for via a broadcast, and asked for
 * by somebody who has muted email.
 */
describe('Notification audience (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;

  interface Tenant {
    sellerId: string;
    userId: string;
    auth: { Authorization: string };
    email: string;
  }
  let alpha: Tenant;
  let beta: Tenant;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  async function makeSeller(label: string): Promise<Tenant> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@notif.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);

    await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `${label} Co`,
        contactPersonName: 'Test Person',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);

    const seller = await h.prisma.seller.findFirstOrThrow({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    await h.prisma.seller.update({
      where: { id: seller.id },
      data: { status: SellerStatus.APPROVED },
    });
    const user = await h.prisma.sellerUser.findFirstOrThrow({
      where: { sellerId: seller.id },
      select: { id: true },
    });

    const login = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);

    return {
      sellerId: seller.id,
      userId: user.id,
      email,
      auth: { Authorization: `Bearer ${login.body.accessToken}` },
    };
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    staffId = staff.id;
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    alpha = await makeSeller('alpha');
    beta = await makeSeller('beta');
  });

  /** The dispatcher, reached the way the app does. */
  function dispatcher(): NotificationDispatchService {
    return h.app.get(NotificationDispatchService);
  }

  // ── The inbox is the caller's own ──────────────────────────────────

  it('a seller reads only their own inbox, and the count is their own', async () => {
    await dispatcher().dispatch({
      audience: [{ kind: 'SELLER_USER', sellerUserId: alpha.userId }],
      topic: 'test.hello',
      category: NotificationCategory.OPERATIONAL,
      channels: [NotificationChannel.IN_APP],
      title: 'For alpha only',
      body: 'This is alpha’s.',
      triggerEvent: 'e2e',
    });

    const mine = await request(h.baseUrl).get('/seller/notifications').set(alpha.auth).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].title).toBe('For alpha only');
    expect(mine.body.unreadCount).toBe(1);

    // Beta is a different company AND a different person. Both would
    // have to fail for a leak; the scoping is by user id, so this is
    // the one that matters.
    const theirs = await request(h.baseUrl).get('/seller/notifications').set(beta.auth).expect(200);
    expect(theirs.body.items).toHaveLength(0);
    expect(theirs.body.unreadCount).toBe(0);

    const count = await request(h.baseUrl)
      .get('/seller/notifications/unread-count')
      .set(beta.auth)
      .expect(200);
    expect(count.body.unread).toBe(0);
  });

  it('marking one read is scoped too — beta cannot read alpha’s row', async () => {
    await dispatcher().dispatch({
      audience: [{ kind: 'SELLER_USER', sellerUserId: alpha.userId }],
      topic: 'test.hello',
      category: NotificationCategory.OPERATIONAL,
      channels: [NotificationChannel.IN_APP],
      title: 'Alpha',
      body: 'body',
      triggerEvent: 'e2e',
    });
    const row = await h.prisma.notificationLog.findFirstOrThrow({
      where: { toInAppUserId: alpha.userId },
      select: { id: true },
    });

    // The id is a real id — it just is not beta's, and the WHERE clause
    // says so rather than a check the next handler could forget.
    await request(h.baseUrl)
      .post(`/seller/notifications/${row.id}/read`)
      .set(beta.auth)
      .expect(404);

    await request(h.baseUrl)
      .post(`/seller/notifications/${row.id}/read`)
      .set(alpha.auth)
      .expect(200);
    const after = await h.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.readAt).not.toBeNull();
  });

  it('the inbox is self-service: it needs no permission grant', async () => {
    // The seller's OWNER role holds everything, so prove it on the
    // narrowest login there is. A VIEWER holds `orders.view` and
    // nothing else; if the inbox were a permission, this would 403 —
    // which is exactly what would have happened to every existing ops,
    // finance and viewer login, since a new permission reaches no role
    // that already exists.
    const viewerRole = await h.prisma.sellerRoleDefinition.findFirstOrThrow({
      where: { sellerId: alpha.sellerId, key: 'viewer' },
      select: { id: true },
    });
    await h.prisma.sellerUser.update({
      where: { id: alpha.userId },
      data: { roleId: viewerRole.id },
    });

    const login = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: alpha.email, password: 'SellerPass-1234' })
      .expect(200);

    await request(h.baseUrl)
      .get('/seller/notifications')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(200);
    await request(h.baseUrl)
      .get('/seller/notifications/subscriptions')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(200);
  });

  // ── CREDENTIAL never reaches an inbox ──────────────────────────────

  it('a credential message is email-only, however it is asked for', async () => {
    const res = await dispatcher().dispatch({
      audience: [{ kind: 'SELLER_USER', sellerUserId: alpha.userId }],
      topic: 'seller.password_reset.email',
      category: NotificationCategory.CREDENTIAL,
      // Asked for in-app explicitly. The policy is above the request.
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      title: 'Reset your password',
      body: 'link',
      triggerEvent: 'e2e',
    });
    expect(res.delivered).toBeGreaterThan(0);

    const inApp = await h.prisma.notificationLog.findMany({
      where: { toInAppUserId: alpha.userId, channel: NotificationChannel.IN_APP },
    });
    expect(inApp).toHaveLength(0);

    const feed = await request(h.baseUrl).get('/seller/notifications').set(alpha.auth).expect(200);
    expect(feed.body.items).toHaveLength(0);
  });

  it('a credential message cannot be silenced, and muting email does not stop it', async () => {
    // Silencing a password reset would lock somebody out of their own
    // account with no way back, which is why the topic refuses.
    await request(h.baseUrl)
      .post('/seller/notifications/subscriptions')
      .set(alpha.auth)
      .send({
        topic: 'seller.password_reset.email',
        mode: NotificationSubscriptionMode.MUTED,
        mutedChannels: [NotificationChannel.EMAIL],
      })
      .expect(409);

    // And even a mute written directly into the table — the shape a
    // future bug or a hand-run UPDATE would take — does not stop it.
    await h.prisma.notificationSubscription.create({
      data: {
        subjectType: NotificationSubjectType.SELLER_USER,
        subjectId: alpha.userId,
        topic: 'seller.password_reset.email',
        mode: NotificationSubscriptionMode.MUTED,
        mutedChannels: [NotificationChannel.EMAIL],
      },
    });

    const res = await dispatcher().dispatch({
      audience: [{ kind: 'SELLER_USER', sellerUserId: alpha.userId }],
      topic: 'seller.password_reset.email',
      category: NotificationCategory.CREDENTIAL,
      channels: [NotificationChannel.EMAIL],
      title: 'Reset your password',
      body: 'link',
      triggerEvent: 'e2e',
    });
    expect(res.delivered).toBe(1);
  });

  it('an ordinary topic CAN be silenced, and the mute is honoured', async () => {
    await request(h.baseUrl)
      .post('/seller/notifications/subscriptions')
      .set(alpha.auth)
      .send({ topic: 'stock.low', mode: NotificationSubscriptionMode.MUTED })
      .expect(200);

    const res = await dispatcher().dispatch({
      audience: [
        { kind: 'SELLER_USER', sellerUserId: alpha.userId },
        { kind: 'SELLER_USER', sellerUserId: beta.userId },
      ],
      topic: 'stock.low',
      category: NotificationCategory.INFORMATIONAL,
      channels: [NotificationChannel.IN_APP],
      title: 'Running low',
      body: 'body',
      triggerEvent: 'e2e',
    });
    // Beta never silenced it, so exactly one delivery is right — a mute
    // that skipped the whole send would be the other, wrong, fix.
    expect(res.delivered).toBe(1);

    const mine = await request(h.baseUrl).get('/seller/notifications').set(alpha.auth).expect(200);
    expect(mine.body.items).toHaveLength(0);
    const theirs = await request(h.baseUrl).get('/seller/notifications').set(beta.auth).expect(200);
    expect(theirs.body.items).toHaveLength(1);
  });

  it('clearing a subscription puts the topic back to its default', async () => {
    await request(h.baseUrl)
      .post('/seller/notifications/subscriptions')
      .set(alpha.auth)
      .send({ topic: 'stock.low', mode: NotificationSubscriptionMode.MUTED })
      .expect(200);
    const listed = await request(h.baseUrl)
      .get('/seller/notifications/subscriptions')
      .set(alpha.auth)
      .expect(200);
    expect(listed.body).toHaveLength(1);

    await request(h.baseUrl)
      .delete('/seller/notifications/subscriptions/stock.low')
      .set(alpha.auth)
      .expect(200);

    const res = await dispatcher().dispatch({
      audience: [{ kind: 'SELLER_USER', sellerUserId: alpha.userId }],
      topic: 'stock.low',
      category: NotificationCategory.INFORMATIONAL,
      channels: [NotificationChannel.IN_APP],
      title: 'Running low',
      body: 'body',
      triggerEvent: 'e2e',
    });
    expect(res.delivered).toBe(1);
  });

  // ── Broadcast ──────────────────────────────────────────────────────

  it('preview counts the audience before anything is sent', async () => {
    const res = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts/preview')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
      })
      .expect(200);

    // Two companies, one user each.
    expect(res.body.recipientCount).toBe(2);
    expect(res.body.sample.length).toBeGreaterThan(0);
    // A preview that wrote something would not be a preview. Scoped to
    // the broadcast's own template: registering the two sellers above
    // legitimately sent them invitation and welcome emails, so a bare
    // count is not zero and asserting it was is a test that fails for a
    // reason that has nothing to do with previews.
    expect(await h.prisma.notificationBroadcast.count()).toBe(0);
    expect(
      await h.prisma.notificationLog.count({
        where: { templateCode: 'system.announcement.email' },
      }),
    ).toBe(0);
  });

  it('a send whose audience moved since the preview is REFUSED', async () => {
    const stale = 2;
    // A third company joins between the count and the click. The
    // sender was shown 2; sending to 3 is a number nobody approved.
    await makeSeller('gamma');

    const res = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
        title: 'Scheduled maintenance',
        body: 'We will be down on Sunday.',
        expectedRecipientCount: stale,
      })
      .expect(409);
    expect(res.body.code).toBe('AUDIENCE_CHANGED');
    expect(await h.prisma.notificationBroadcast.count()).toBe(0);
  });

  it('a broadcast reaches every seller, once each, and is recorded', async () => {
    const preview = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts/preview')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
      })
      .expect(200);

    const sent = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
        title: 'Scheduled maintenance',
        body: 'We will be down on Sunday.',
        expectedRecipientCount: preview.body.recipientCount,
      })
      .expect(200);
    expect(sent.body.recipientCount).toBe(2);
    expect(sent.body.delivered).toBe(2);

    for (const t of [alpha, beta]) {
      const feed = await request(h.baseUrl).get('/seller/notifications').set(t.auth).expect(200);
      expect(feed.body.items).toHaveLength(1);
      expect(feed.body.items[0].title).toBe('Scheduled maintenance');
    }

    const record = await h.prisma.notificationBroadcast.findUniqueOrThrow({
      where: { id: sent.body.broadcastId },
    });
    expect(record.status).toBe('SENT');
    expect(record.recipientCount).toBe(2);
    expect(record.createdByStaffId).toBe(staffId);
    // The audience is stored as chosen — "who did this go to" must
    // still answer a month later, when the population has moved on.
    expect(record.audience).toEqual([{ kind: 'ALL_SELLERS' }]);

    const listed = await request(h.baseUrl)
      .get('/admin/notifications/broadcasts')
      .set(staffAuth)
      .expect(200);
    expect(listed.body).toHaveLength(1);
  });

  it('the same person selected twice is still notified once', async () => {
    // ALL_SELLERS and this seller's own org overlap completely. Two
    // selectors, one person, one message.
    const preview = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts/preview')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }, { kind: 'SELLER_ORG', sellerId: alpha.sellerId }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
      })
      .expect(200);
    expect(preview.body.recipientCount).toBe(2);

    await request(h.baseUrl)
      .post('/admin/notifications/broadcasts')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }, { kind: 'SELLER_ORG', sellerId: alpha.sellerId }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
        title: 'Once',
        body: 'Only once.',
        expectedRecipientCount: preview.body.recipientCount,
      })
      .expect(200);

    const feed = await request(h.baseUrl).get('/seller/notifications').set(alpha.auth).expect(200);
    expect(feed.body.items).toHaveLength(1);
  });

  it('a CREDENTIAL broadcast is refused outright', async () => {
    const res = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }],
        category: NotificationCategory.CREDENTIAL,
        channels: [NotificationChannel.EMAIL],
        title: 'Your password',
        body: 'Nobody broadcasts a credential.',
        expectedRecipientCount: 2,
      })
      .expect(409);
    expect(res.body.code).toBe('CATEGORY_NOT_BROADCASTABLE');
  });

  it('a broadcast to nobody is refused rather than recorded as sent', async () => {
    const res = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'SELLER_ROLE', sellerId: alpha.sellerId, roleKey: 'no-such-role' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
        title: 'Hello?',
        body: 'Anyone there?',
        expectedRecipientCount: 0,
      })
      .expect(409);
    expect(res.body.code).toBe('EMPTY_AUDIENCE');
    expect(await h.prisma.notificationBroadcast.count()).toBe(0);
  });

  // ── Staff side ─────────────────────────────────────────────────────

  it('staff have their own inbox, addressed by permission', async () => {
    // A permission is the durable way to name a group: roles are rows
    // an admin can invent and rename, permissions are not.
    const preview = await request(h.baseUrl)
      .post('/admin/notifications/broadcasts/preview')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'STAFF_PERMISSION', permission: 'orders.view' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
      })
      .expect(200);
    // The SUPER_ADMIN holds everything implicitly, so it is reached.
    expect(preview.body.recipientCount).toBeGreaterThan(0);

    await request(h.baseUrl)
      .post('/admin/notifications/broadcasts')
      .set(staffAuth)
      .send({
        audience: [{ kind: 'STAFF_PERMISSION', permission: 'orders.view' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
        title: 'Ops notice',
        body: 'Read this.',
        expectedRecipientCount: preview.body.recipientCount,
      })
      .expect(200);

    const feed = await request(h.baseUrl).get('/admin/notifications').set(staffAuth).expect(200);
    expect(feed.body.items.length).toBeGreaterThan(0);
    expect(feed.body.unreadCount).toBeGreaterThan(0);

    const marked = await request(h.baseUrl)
      .post('/admin/notifications/read-all')
      .set(staffAuth)
      .expect(200);
    expect(marked.body.marked).toBeGreaterThan(0);

    const after = await request(h.baseUrl)
      .get('/admin/notifications/unread-count')
      .set(staffAuth)
      .expect(200);
    expect(after.body.unread).toBe(0);
  });

  it('sending is gated on a permission the inbox is not', async () => {
    // A staff member with a role that cannot broadcast: their inbox
    // still opens (self-service), their send does not.
    const role = await h.prisma.staffRoleDefinition.create({
      data: {
        key: `reader-${Date.now()}`,
        name: 'Reader',
        description: 'Reads orders.',
        permissions: { create: [{ permission: 'orders.view' }] },
      },
      select: { id: true },
    });
    const reader = await createTestStaff(h.prisma, { role: StaffRole.CALL_AGENT });
    await h.prisma.staffUser.update({ where: { id: reader.id }, data: { roleId: role.id } });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: reader.email, password: reader.password })
      .expect(200);
    const readerAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    await request(h.baseUrl).get('/admin/notifications').set(readerAuth).expect(200);
    await request(h.baseUrl)
      .post('/admin/notifications/broadcasts/preview')
      .set(readerAuth)
      .send({
        audience: [{ kind: 'ALL_SELLERS' }],
        category: NotificationCategory.ANNOUNCEMENT,
        channels: [NotificationChannel.IN_APP],
      })
      .expect(403);
  });
});
