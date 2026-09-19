import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { NotificationChannel, SellerStatus, StaffRole } from '@skydrop/db';
import { ResellerTermsNotifier } from '../../src/modules/reseller-store-terms/services/reseller-terms-notifier.service';
import { StoreRequestNotifier } from '../../src/modules/store-order-request/services/store-request-notifier.service';
import {
  bootTestApp,
  createTestStaff,
  defaultStoreFor,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * A reseller store's inbox, end to end (2026-09-19).
 *
 * The unit specs pin the rules on mocks. This pins what only a real
 * database and a real HTTP stack can show:
 *
 *   - a message sent to a store lands on BOTH channels, keyed so that a
 *     re-send is refused by the NOTIF-2 partial unique rather than
 *     arriving twice;
 *   - one store's people cannot see another store's rows — proven by
 *     two real stores under two real sellers, not by reading a WHERE
 *     clause;
 *   - dismissing hides a row from the list and from the unread count,
 *     and the row SURVIVES (a delete would reopen the dedup hole);
 *   - a locked topic is refused a mute by the live endpoint, and the
 *     refusal is the server's own verdict;
 *   - the inbox is reachable by every store role, because it is
 *     self-service rather than a permission nobody has been granted.
 */
describe('reseller store notifications (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  async function makeSeller(label: string): Promise<{
    sellerId: string;
    auth: { Authorization: string };
  }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@inbox.test`;
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
    const row = await h.prisma.seller.findFirstOrThrow({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    await h.prisma.seller.update({
      where: { id: row.id },
      data: { status: SellerStatus.APPROVED },
    });
    const login = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);
    return { sellerId: row.id, auth: { Authorization: `Bearer ${login.body.accessToken}` } };
  }

  /** Opens a store with a first user of the given role, and signs them in. */
  async function makeStore(
    seller: { auth: { Authorization: string } },
    label: string,
    roleKey = 'owner',
  ): Promise<{ storeId: string; userId: string; auth: { Authorization: string } }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(seller.auth)
      .send({
        name: `${label} ${Math.random().toString(36).slice(2, 8)}`,
        contactEmail: email,
        contactPhone: '+919800000002',
        invite: { email, fullName: `${label} Person`, roleKey },
      })
      .expect(201);
    const storeId = (created.body as { id: string }).id;
    const invitation = await h.prisma.storeUserInvitation.findFirstOrThrow({
      where: { storeId, usedAt: null, deletedAt: null },
      select: { id: true },
    });
    const plaintext = `e2e-invite-${randomBytes(24).toString('hex')}`;
    await h.prisma.storeUserInvitation.update({
      where: { id: invitation.id },
      data: { token: createHash('sha256').update(plaintext, 'utf8').digest('hex') },
    });
    const accepted = await request(h.baseUrl)
      .post('/auth/store/invitations/accept')
      .send({ token: plaintext, password: 'StorePass-1234', fullName: `${label} Person` })
      .expect(201);
    const user = await h.prisma.storeUser.findFirstOrThrow({
      where: { storeId, deletedAt: null },
      select: { id: true },
    });
    return {
      storeId,
      userId: user.id,
      auth: { Authorization: `Bearer ${(accepted.body as { accessToken: string }).accessToken}` },
    };
  }

  /**
   * Sends a real store notification through a real notifier.
   *
   * Deliberately NOT a hand-written `notificationLog.create`: the thing
   * worth proving is that the production path writes both legs and keys
   * them apart, and a fixture row would pass while the sender was broken.
   * Terms-published is the simplest one to trigger — it needs only a
   * store, and it goes to the people who may accept terms.
   */
  async function sendTermsPublished(store: { storeId: string }, version: number): Promise<void> {
    await h.app.get(ResellerTermsNotifier, { strict: false }).published({
      storeId: store.storeId,
      termsVersionId: `${store.storeId}-v${version}`,
      version,
      storeName: 'A Store',
      sellerName: 'A Seller',
    });
  }

  /**
   * A bare order under the seller's own channel store.
   *
   * `notification_logs.order_id` is a FOREIGN KEY, so a made-up uuid
   * would fail on the INSERT rather than on the rule under test. Seeded
   * directly rather than driven through HTTP: the order is scenery here,
   * and driving a create would need catalogue and stock setup whose only
   * effect would be more ways for the test to silently no-op.
   */
  async function anOrderFor(sellerId: string): Promise<string> {
    const channel = await defaultStoreFor(h.prisma, sellerId);
    const order = await h.prisma.order.create({
      data: {
        sellerId,
        storeId: channel.id,
        storeNameSnapshot: channel.name,
        orderNumber: `SD-2026-99-${Math.floor(Math.random() * 900000 + 100000)}`,
        status: 'PENDING_CONFIRMATION',
        paymentMode: 'PREPAID',
        recipientName: 'A Customer',
        recipientPhoneE164: '+919812345678',
        recipientAddressLine1: '1 Private Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientCity: 'Bengaluru',
        recipientStateProvince: 'Karnataka',
        recipientPostalCode: '560001',
        recipientCountryCode: 'IN',
        declaredValueInr: '100.00',
      },
      select: { id: true },
    });
    return order.id;
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  it('one message lands on BOTH channels, and a re-send adds nothing', async () => {
    const seller = await makeSeller('both');
    const store = await makeStore(seller, 'both');

    await sendTermsPublished(store, 1);

    const rows = await h.prisma.notificationLog.findMany({
      where: { toStoreId: store.storeId },
      select: { channel: true, templateCode: true, eventId: true, toInAppUserId: true },
    });
    // Two legs, with DIFFERENT template codes and DIFFERENT event ids —
    // the NOTIF-14 rule that one notification's halves are silenced by
    // different people and must not share a key.
    expect(rows).toHaveLength(2);
    const inApp = rows.find((r) => r.channel === NotificationChannel.IN_APP);
    const email = rows.find((r) => r.channel === NotificationChannel.EMAIL);
    expect(inApp?.templateCode).toBe('store.terms_published');
    expect(email?.templateCode).toBe('store.terms_published.email');
    expect(inApp?.eventId).not.toBe(email?.eventId);
    // The email keeps the key it has always had; the inbox leg appends.
    expect(email?.eventId).toBe(`reseller_terms_published:${store.storeId}-v1`);
    expect(inApp?.eventId).toBe(`reseller_terms_published:${store.storeId}-v1:inapp`);
    // The in-app row is addressed to the PERSON and stamped with the
    // store — both halves of what the feed scopes on.
    expect(inApp?.toInAppUserId).toBe(store.userId);

    // A re-send of the same version is refused by the partial unique.
    await sendTermsPublished(store, 1);
    expect(await h.prisma.notificationLog.count({ where: { toStoreId: store.storeId } })).toBe(2);
  });

  it('the store reads its own inbox: list, count, read, unread, dismiss', async () => {
    const seller = await makeSeller('inbox');
    const store = await makeStore(seller, 'inbox');
    await sendTermsPublished(store, 1);
    await sendTermsPublished(store, 2);

    const list = await request(h.baseUrl).get('/store/notifications').set(store.auth).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.unreadCount).toBe(2);
    const first = list.body.items[0] as { id: string; topic: string; readAt: string | null };
    expect(first.topic).toBe('store.terms_published');
    expect(first.readAt).toBeNull();

    const counted = await request(h.baseUrl)
      .get('/store/notifications/unread-count')
      .set(store.auth)
      .expect(200);
    expect(counted.body.unread).toBe(2);

    await request(h.baseUrl)
      .post(`/store/notifications/${first.id}/read`)
      .set(store.auth)
      .expect(200);
    expect(
      (await request(h.baseUrl).get('/store/notifications/unread-count').set(store.auth)).body
        .unread,
    ).toBe(1);

    // Un-reading is the mirror: having read something and having dealt
    // with it are different (NOTIF-21).
    await request(h.baseUrl)
      .post(`/store/notifications/${first.id}/unread`)
      .set(store.auth)
      .expect(200);
    expect(
      (await request(h.baseUrl).get('/store/notifications/unread-count').set(store.auth)).body
        .unread,
    ).toBe(2);

    // DISMISS: gone from the list AND from the count, row still there.
    await request(h.baseUrl).delete(`/store/notifications/${first.id}`).set(store.auth).expect(200);
    const after = await request(h.baseUrl).get('/store/notifications').set(store.auth).expect(200);
    expect(after.body.items).toHaveLength(1);
    expect(after.body.unreadCount).toBe(1);
    // NOT a delete: `notification_logs` is the ledger the dedup gate
    // reads, so removing the row would let a re-emit send again.
    const kept = await h.prisma.notificationLog.findUniqueOrThrow({
      where: { id: first.id },
      select: { dismissedAt: true },
    });
    expect(kept.dismissedAt).not.toBeNull();
    // And the dedup gate still holds against it.
    await sendTermsPublished(store, 1);
    expect(await h.prisma.notificationLog.count({ where: { toStoreId: store.storeId } })).toBe(4);
  });

  it('a store user cannot see, read or dismiss another store’s rows', async () => {
    const sellerA = await makeSeller('mine');
    const sellerB = await makeSeller('theirs');
    const mine = await makeStore(sellerA, 'mine');
    const theirs = await makeStore(sellerB, 'theirs');

    await sendTermsPublished(mine, 1);
    await sendTermsPublished(theirs, 1);

    // Each sees exactly one — their own.
    const mineList = await request(h.baseUrl)
      .get('/store/notifications')
      .set(mine.auth)
      .expect(200);
    const theirsList = await request(h.baseUrl)
      .get('/store/notifications')
      .set(theirs.auth)
      .expect(200);
    expect(mineList.body.items).toHaveLength(1);
    expect(theirsList.body.items).toHaveLength(1);
    expect(mineList.body.items[0].id).not.toBe(theirsList.body.items[0].id);

    const theirRow = theirsList.body.items[0].id as string;

    // Reaching for the other store's row by id is a 404 that says
    // nothing about whether it exists.
    await request(h.baseUrl)
      .post(`/store/notifications/${theirRow}/read`)
      .set(mine.auth)
      .expect(404);
    await request(h.baseUrl).delete(`/store/notifications/${theirRow}`).set(mine.auth).expect(404);

    // And nothing happened to it.
    const untouched = await h.prisma.notificationLog.findUniqueOrThrow({
      where: { id: theirRow },
      select: { readAt: true, dismissedAt: true },
    });
    expect(untouched.readAt).toBeNull();
    expect(untouched.dismissedAt).toBeNull();

    // "Clear all" and "mark all read" are scoped too — the blast-radius
    // versions of the same question.
    await request(h.baseUrl).post('/store/notifications/read-all').set(mine.auth).expect(200);
    await request(h.baseUrl).delete('/store/notifications').set(mine.auth).expect(200);
    const stillThere = await h.prisma.notificationLog.findUniqueOrThrow({
      where: { id: theirRow },
      select: { readAt: true, dismissedAt: true },
    });
    expect(stillThere.readAt).toBeNull();
    expect(stillThere.dismissedAt).toBeNull();
  });

  it('the inbox is self-service: even the narrowest role reaches it', async () => {
    // NOTIF-11's second argument, proven rather than asserted: a
    // permission would have had to be GRANTED, and a viewer holds the
    // fewest of them.
    const seller = await makeSeller('viewer');
    const viewer = await makeStore(seller, 'viewer', 'viewer');

    await request(h.baseUrl).get('/store/notifications').set(viewer.auth).expect(200);
    await request(h.baseUrl).get('/store/notifications/unread-count').set(viewer.auth).expect(200);
    await request(h.baseUrl).get('/store/notifications/topics').set(viewer.auth).expect(200);
    await request(h.baseUrl).get('/store/notifications/subscriptions').set(viewer.auth).expect(200);
  });

  it('a person silences a topic and stops receiving it; a locked one is refused', async () => {
    const seller = await makeSeller('mute');
    const store = await makeStore(seller, 'mute');

    const topics = await request(h.baseUrl)
      .get('/store/notifications/topics')
      .set(store.auth)
      .expect(200);
    const list = topics.body as Array<{
      topic: string;
      mutable: boolean;
      immutableReason: unknown;
    }>;
    // The list carries the flag and the reason, so the screen can render
    // a lock rather than a switch that always refuses.
    const locked = list.find((t) => t.topic === 'store.request_approved');
    expect(locked?.mutable).toBe(false);
    expect(typeof locked?.immutableReason).toBe('string');

    // The live endpoint refuses the mute, with the server's own verdict.
    const refused = await request(h.baseUrl)
      .post('/store/notifications/subscriptions')
      .set(store.auth)
      .send({ topic: 'store.request_approved', mode: 'MUTED' })
      .expect(409);
    expect(refused.body.code).toBe('NOTIFICATION_NOT_MUTABLE');

    // A mutable one is accepted, and then nothing arrives on it.
    await request(h.baseUrl)
      .post('/store/notifications/subscriptions')
      .set(store.auth)
      .send({ topic: 'store.terms_published', mode: 'MUTED' })
      .expect(200);

    await sendTermsPublished(store, 7);
    expect(await h.prisma.notificationLog.count({ where: { toStoreId: store.storeId } })).toBe(0);

    // Clearing the choice puts it back to the default, which is ON.
    await request(h.baseUrl)
      .delete('/store/notifications/subscriptions/store.terms_published')
      .set(store.auth)
      .expect(200);
    await sendTermsPublished(store, 8);
    expect(await h.prisma.notificationLog.count({ where: { toStoreId: store.storeId } })).toBe(2);
  });

  it('the STORE’s own switch removes a channel for everybody there', async () => {
    const seller = await makeSeller('storewide');
    const store = await makeStore(seller, 'storewide');

    const before = await request(h.baseUrl)
      .get('/store/notification-preferences')
      .set(store.auth)
      .expect(200);
    const terms = (before.body as Array<{ category: string; set: boolean; mutable: boolean }>).find(
      (r) => r.category === 'TERMS',
    );
    expect(terms).toMatchObject({ set: false, mutable: true });

    // Email off, inbox on.
    await request(h.baseUrl)
      .put('/store/notification-preferences')
      .set(store.auth)
      .send({ category: 'TERMS', emailEnabled: false, inAppEnabled: true })
      .expect(200);

    await sendTermsPublished(store, 1);
    const rows = await h.prisma.notificationLog.findMany({
      where: { toStoreId: store.storeId },
      select: { channel: true },
    });
    expect(rows.map((r) => r.channel)).toEqual([NotificationChannel.IN_APP]);

    // A category with nothing choosable in it is refused rather than
    // stored as a switch nobody reads.
    const refused = await request(h.baseUrl)
      .put('/store/notification-preferences')
      .set(store.auth)
      .send({ category: 'MONEY', emailEnabled: false, inAppEnabled: false })
      .expect(409);
    expect(refused.body.code).toBe('STORE_CATEGORY_NOT_MUTABLE');
  });

  it('the store-wide switch removes a MUTABLE order topic, and is ignored for a LOCKED one', async () => {
    const seller = await makeSeller('twokinds');
    const store = await makeStore(seller, 'twokinds');

    // ORDER_UPDATES is allowed a switch because it holds one mutable
    // topic — the seller correcting a customer's record.
    await request(h.baseUrl)
      .put('/store/notification-preferences')
      .set(store.auth)
      .send({ category: 'ORDER_UPDATES', emailEnabled: false, inAppEnabled: false })
      .expect(200);

    const notifier = h.app.get(StoreRequestNotifier, { strict: false });

    // The MUTABLE one is suppressed on both channels.
    await notifier.customerChangedBySeller({
      storeId: store.storeId,
      eventKey: 'e2e-customer-1',
      sellerName: 'A Seller',
      customerName: 'A Customer',
      changes: 'Email: a@x.test → b@x.test',
    });
    expect(await h.prisma.notificationLog.count({ where: { toStoreId: store.storeId } })).toBe(0);

    // The LOCKED one arrives anyway — this is the back door the
    // per-topic rule would otherwise leave open, and a worse one than a
    // personal mute, because one admin here could take the message away
    // from everybody at the store. `orderChangedBySeller` is on
    // IMMUTABLE_TOPICS, so the store's own switch is never consulted.
    //
    // It needs a real order: `notification_logs.order_id` is a foreign
    // key, so a made-up uuid would fail on the INSERT rather than on the
    // rule being tested.
    const orderId = await anOrderFor(seller.sellerId);
    await notifier.orderChangedBySeller({
      storeId: store.storeId,
      eventKey: 'e2e-order-1',
      orderId,
      orderNumber: 'SD-E2E-1',
      sellerName: 'A Seller',
      changes: 'Quantity: 1 → 2',
      money: '',
      supersededRequest: false,
    });
    const rows = await h.prisma.notificationLog.findMany({
      where: { toStoreId: store.storeId },
      select: { templateCode: true },
    });
    // The INBOX ROW ONLY, against a real database (owner, 2026-09-20).
    //
    // This asserted both legs until the email was retired
    // (`RETIRED_EMAIL_TEMPLATES`), and the change of expectation IS the
    // point: the gate sits in `NotificationLedgerService` BEFORE the row
    // is written, so a retired leg leaves no `notification_logs` row at
    // all. A row would be worse than a stray email — it would sit QUEUED
    // for ever and NOTIF-22's watchdog would re-queue it and then raise
    // `email-undelivered` about a message nobody meant to send.
    //
    // The unit spec pins the MAP (every retired code names a topic the
    // catalogue serves); this pins the BEHAVIOUR, which only a real
    // database can show.
    expect(rows.map((r) => r.templateCode).sort()).toEqual(['store.order_changed_by_seller']);
  });
});
