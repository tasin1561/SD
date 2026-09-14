import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { ProductStatus, SellerStatus, StaffRole } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  defaultStoreFor,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Cross-tenant isolation (IDOR).
 *
 * Every seller controller passes the authenticated `sellerId` down to its
 * service — that much is visible by reading. What reading CANNOT tell you
 * is whether the service actually puts it in the WHERE clause. A handler
 * that accepts a sellerId and then looks the row up by id alone is
 * indistinguishable from a correct one at the controller layer, and the
 * bug it produces — seller A reading seller B's orders, customers, or
 * webhook signing keys — is the kind that ends a B2B product.
 *
 * So this proves it from outside: two real sellers, each authenticated,
 * each reaching for the other's resources by id. Everything here must be
 * 403 or 404. A 200 is a breach.
 *
 * 404-over-403 is the preferred answer on a read (it does not confirm the
 * id exists), but either is acceptable — what matters is that the DATA
 * never comes back.
 */
describe('cross-tenant isolation (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };

  interface Tenant {
    sellerId: string;
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
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@tenant.test`;
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

    const login = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);

    return {
      sellerId: seller.id,
      email,
      auth: { Authorization: `Bearer ${login.body.accessToken}` },
    };
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    alpha = await makeSeller('alpha');
    beta = await makeSeller('beta');
  });

  /** A cross-tenant read must not return the row. */
  function expectDenied(status: number, body: unknown, what: string): void {
    if (status === 200 || status === 201) {
      throw new Error(
        `BREACH: cross-tenant access to ${what} returned ${status} with a body: ${JSON.stringify(
          body,
        ).slice(0, 300)}`,
      );
    }
    expect([400, 403, 404]).toContain(status);
  }

  it('cannot read another seller’s order', async () => {
    // Seeded directly: the READ is what is under test, and driving the
    // HTTP create would need catalog + variant setup whose only effect
    // here would be more ways for this test to silently no-op.
    const store = await defaultStoreFor(h.prisma, alpha.sellerId);
    const order = await h.prisma.order.create({
      data: {
        sellerId: alpha.sellerId,
        storeId: store.id,
        storeNameSnapshot: store.name,
        orderNumber: `SD-2026-99-${Math.floor(Math.random() * 900000 + 100000)}`,
        status: 'PENDING_CONFIRMATION',
        paymentMode: 'PREPAID',
        recipientName: 'Alpha Customer',
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

    // Alpha can see their own — proves the id is real and the route works,
    // so the denial below is a denial and not a 404 for the wrong reason.
    await request(h.baseUrl).get(`/seller/orders/${order.id}`).set(alpha.auth).expect(200);

    const res = await request(h.baseUrl).get(`/seller/orders/${order.id}`).set(beta.auth);
    expectDenied(res.status, res.body, 'an order');
  });

  it('cannot read another seller’s customers', async () => {
    const mine = await request(h.baseUrl).get('/seller/customers').set(alpha.auth);
    expect(mine.status).toBe(200);
    const theirs = await request(h.baseUrl).get('/seller/customers').set(beta.auth);
    expect(theirs.status).toBe(200);
    // Two fresh tenants: neither list may contain the other's rows.
    const alphaIds = new Set((mine.body.items ?? mine.body ?? []).map((c: { id: string }) => c.id));
    for (const c of theirs.body.items ?? theirs.body ?? []) {
      expect(alphaIds.has((c as { id: string }).id)).toBe(false);
    }
  });

  it('cannot read another seller’s webhook endpoints — they carry a signing key', async () => {
    // The worst possible leak on this surface: `secretKey` is what a
    // seller's system uses to trust that a payload came from us.
    const created = await request(h.baseUrl)
      .post('/seller/webhook-endpoints')
      .set(alpha.auth)
      .send({
        // Must be a hostname that actually RESOLVES and is public: the
        // SSRF guard rejects an endpoint it cannot establish is safe.
        // `alpha.example.com` was used here and does not exist.
        url: 'https://example.com/alpha-hook',
        subscribedEvents: ['order.created'],
      })
      .expect(201);

    const res = await request(h.baseUrl)
      .get(`/seller/webhook-endpoints/${created.body.id}`)
      .set(beta.auth);
    expectDenied(res.status, res.body, 'a webhook endpoint (and its secretKey)');
  });

  it('cannot read another seller’s API keys', async () => {
    const mine = await request(h.baseUrl).get('/seller/api-keys').set(alpha.auth);
    expect(mine.status).toBe(200);
    const theirs = await request(h.baseUrl).get('/seller/api-keys').set(beta.auth);
    const alphaIds = new Set((mine.body.items ?? mine.body ?? []).map((k: { id: string }) => k.id));
    for (const k of theirs.body.items ?? theirs.body ?? []) {
      expect(alphaIds.has((k as { id: string }).id)).toBe(false);
    }
  });

  it('cannot read another seller’s tickets', async () => {
    const created = await request(h.baseUrl)
      .post('/seller/tickets')
      .set(alpha.auth)
      .send({ subject: 'Alpha private issue', description: 'commercially sensitive' })
      .expect(201);

    const res = await request(h.baseUrl).get(`/seller/tickets/${created.body.id}`).set(beta.auth);
    expectDenied(res.status, res.body, 'a ticket');
  });

  it('cannot read another seller’s addresses', async () => {
    const created = await request(h.baseUrl)
      .post('/seller/addresses')
      .set(alpha.auth)
      .send({
        type: 'BD_ORIGIN',
        label: 'Alpha HQ',
        contactName: 'Alpha Person',
        contactPhone: '+8801712345678',
        line1: '1 Private Road',
        city: 'Dhaka',
        stateProvince: 'Dhaka',
        postalCode: '1000',
      })
      .expect(201);

    const res = await request(h.baseUrl).get(`/seller/addresses/${created.body.id}`).set(beta.auth);
    expectDenied(res.status, res.body, 'an address');
  });

  it('cannot see another seller’s wallet balance or ledger', async () => {
    const res = await request(h.baseUrl).get('/seller/wallet').set(beta.auth).expect(200);
    // A fresh tenant's wallet must be its own — never an aggregate.
    const balances = res.body.balances ?? [];
    for (const b of balances) {
      expect((b as { sellerId?: string }).sellerId ?? beta.sellerId).toBe(beta.sellerId);
    }
  });

  it('cannot touch another seller’s staged CSV rows', async () => {
    // A staged row is a half-formed order carrying a real customer's
    // name, phone and address. It is the one place that data sits
    // OUTSIDE the orders table, so it is also the one place a
    // seller-scoping mistake would not be caught by the order tests.
    const upload = await h.prisma.bulkOrderUpload.create({
      data: {
        sellerId: alpha.sellerId,
        fileName: 'a.csv',
        spacesKey: 'k',
        fileSizeBytes: 10,
        status: 'COMPLETED',
        rowCount: 1,
      },
      select: { id: true },
    });
    const row = await h.prisma.stagedOrderRow.create({
      data: {
        uploadId: upload.id,
        sellerId: alpha.sellerId,
        rowNumber: 1,
        data: { customerName: 'Alpha Customer', customerPhone: '+919876500099' },
        problems: [],
        status: 'NEEDS_INPUT',
      },
      select: { id: true },
    });

    // Beta must not see it in their queue…
    const list = await request(h.baseUrl).get('/seller/orders-pending').set(beta.auth);
    if (list.status === 200) {
      expect(JSON.stringify(list.body)).not.toContain('Alpha Customer');
      expect(JSON.stringify(list.body)).not.toContain(row.id);
    }

    // …nor edit, import or discard it by id.
    for (const [path, body] of [
      [`/seller/orders-pending/${row.id}`, { data: { customerName: 'hijacked' } }],
      [`/seller/orders-pending/${row.id}/import`, {}],
      [`/seller/orders-pending/${row.id}/discard`, {}],
    ] as Array<[string, object]>) {
      const res = await request(h.baseUrl).post(path).set(beta.auth).send(body);
      expectDenied(res.status, res.body, `staged row via ${path}`);
    }

    // And it is untouched.
    const after = await h.prisma.stagedOrderRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('NEEDS_INPUT');
    expect((after.data as Record<string, unknown>)['customerName']).toBe('Alpha Customer');
  });

  it('cannot read another seller’s bank-transfer proof', async () => {
    // The proof is a bank screenshot or receipt — account numbers,
    // names, balances. It lives in Spaces behind a presigned URL, so a
    // missing seller check here would hand over a working link to the
    // file itself rather than merely a row.
    // Created rather than looked up: a `findFirst` that returned nothing
    // would turn this into a test that silently passes without ever
    // reaching the assertion.
    const bank = await h.prisma.platformBankAccount.create({
      data: {
        label: 'Tenant Test Bank',
        bankName: 'Test',
        accountName: 'Skydrop',
        accountNumber: '000',
        currency: 'INR',
      },
      select: { id: true },
    });

    const topup = await h.prisma.walletTopupRequest.create({
      data: {
        sellerId: alpha.sellerId,
        bankAccountId: bank.id,
        amount: '5000.00',
        currency: 'INR',
        status: 'PENDING',
        proofSpacesKey: `topup-proofs/${alpha.sellerId}/secret-receipt.png`,
      },
      select: { id: true },
    });

    const res = await request(h.baseUrl)
      .get(`/seller/wallet/topups/${topup.id}/proof-url`)
      .set(beta.auth);
    expectDenied(res.status, res.body, "another seller's topup proof");
    // Belt and braces: no presigned URL leaked in the body either.
    expect(JSON.stringify(res.body)).not.toContain('secret-receipt');
  });

  it('cannot cancel another seller’s order', async () => {
    const store = await defaultStoreFor(h.prisma, alpha.sellerId);
    const order = await h.prisma.order.create({
      data: {
        orderNumber: `SD-2026-99-${Date.now().toString().slice(-6)}`,
        sellerId: alpha.sellerId,
        storeId: store.id,
        storeNameSnapshot: store.name,
        recipientName: 'Alpha Customer',
        recipientPhoneE164: '+919876500098',
        recipientAddressLine1: 'a',
        recipientAddressLine2: 'Opposite the school',
        recipientCity: 'Delhi',
        recipientStateProvince: 'Delhi',
        recipientPostalCode: '110001',
        paymentMode: 'COD',
        declaredValueInr: '100',
        totalWeightGrams: 100,
        status: 'PENDING_CONFIRMATION',
      },
      select: { id: true },
    });

    const res = await request(h.baseUrl)
      .post(`/seller/orders/${order.id}/cancel`)
      .set(beta.auth)
      .send({});
    expectDenied(res.status, res.body, "another seller's order cancel");

    const after = await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING_CONFIRMATION');
  });

  it('a seller token is refused on every admin surface', async () => {
    // The seller guard and the staff guard are different; a seller JWT
    // must not be accepted as staff anywhere.
    for (const path of [
      '/admin/orders',
      '/admin/sellers',
      '/admin/tickets',
      '/admin/courier-ops/pickups',
      '/admin/stock-units/triage',
      '/admin/courier-settlements/reconciliation',
    ]) {
      const res = await request(h.baseUrl).get(path).set(alpha.auth);
      expect([401, 403]).toContain(res.status);
    }
  });

  it('an unauthenticated caller is refused on every seller surface', async () => {
    for (const path of [
      '/seller/orders',
      '/seller/customers',
      '/seller/wallet',
      '/seller/webhook-endpoints',
      '/seller/api-keys',
      '/seller/tickets',
    ]) {
      const res = await request(h.baseUrl).get(path);
      // 401 specifically, not "any error": a 404 here would mean the
      // path is wrong and the assertion proves nothing, which is worse
      // than no test at all.
      expect(res.status).toBe(401);
    }
  });

  it('a tampered JWT is rejected', async () => {
    // Flip the last character of the signature.
    const raw = alpha.auth.Authorization.replace('Bearer ', '');
    const parts = raw.split('.');
    const sig = parts[2] ?? '';
    const tampered = `${parts[0]}.${parts[1]}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
    const res = await request(h.baseUrl)
      .get('/seller/orders')
      .set({ Authorization: `Bearer ${tampered}` });
    expect(res.status).toBe(401);
  });

  it('an alg=none / unsigned token is rejected', async () => {
    // The classic JWT bypass: strip the signature and claim alg none.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: alpha.sellerId, sellerId: alpha.sellerId, type: 'seller' }),
    ).toString('base64url');
    const res = await request(h.baseUrl)
      .get('/seller/orders')
      .set({ Authorization: `Bearer ${header}.${payload}.` });
    expect(res.status).toBe(401);
  });

  // ─── Reseller stores (RS-2) ────────────────────────────────────────────
  //
  // A store login is a THIRD identity. Every store endpoint takes the store
  // from the token and never from the request, so the question here is not
  // "can store A name store B's id" on a read (there is no id to name) but:
  // does anything that DOES take an id — a member, an invitation — reach
  // outside the caller's store, and does any other identity's token open a
  // store surface (or a store token open theirs)?

  interface StoreLogin {
    storeId: string;
    storeName: string;
    storeUserId: string;
    auth: { Authorization: string };
  }

  /**
   * Opens a reseller store for `owner` through the real seller endpoint,
   * inviting its first user, then accepts that invitation through the real
   * store endpoint. The invitation token only ever leaves the API in an
   * email, so the stored hash is pointed at a plaintext this test knows —
   * the row, its role and its expiry are exactly what the service wrote.
   */
  async function makeStoreUser(owner: Tenant, label: string): Promise<StoreLogin> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const storeName = `${label} Store ${Math.random().toString(36).slice(2, 8)}`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(owner.auth)
      .send({
        name: storeName,
        invite: { email, fullName: `${label} Owner`, roleKey: 'owner' },
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
      .send({ token: plaintext, password: 'StorePass-1234', fullName: `${label} Owner` })
      .expect(201);

    const user = await h.prisma.storeUser.findFirstOrThrow({
      where: { storeId, deletedAt: null },
      select: { id: true },
    });
    return {
      storeId,
      storeName,
      storeUserId: user.id,
      auth: { Authorization: `Bearer ${(accepted.body as { accessToken: string }).accessToken}` },
    };
  }

  it('a store user sees only their own store, and cannot touch another store’s team', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');
    const storeB = await makeStoreUser(beta, 'store-b');

    // Own profile and team — proves the login works, so the denials below
    // are denials and not a broken token. The profile names its store
    // rather than carrying an id: the store is the token's, not a parameter.
    const profile = await request(h.baseUrl).get('/store/profile').set(storeA.auth).expect(200);
    expect((profile.body as { name: string }).name).toBe(storeA.storeName);
    expect(JSON.stringify(profile.body)).not.toContain(storeB.storeName);
    const team = await request(h.baseUrl).get('/store/team').set(storeA.auth).expect(200);
    expect(JSON.stringify(team.body)).not.toContain(storeB.storeUserId);

    // Store B's member and invitation, reached by id from store A.
    const bInvite = await request(h.baseUrl)
      .post('/store/team/invitations')
      .set(storeB.auth)
      .send({
        email: `b-colleague-${Date.now()}@store.test`,
        fullName: 'B Colleague',
        roleKey: 'viewer',
      })
      .expect(201);
    const bInvitationId = await h.prisma.storeUserInvitation.findFirstOrThrow({
      where: { storeId: storeB.storeId, usedAt: null, deletedAt: null },
      select: { id: true },
    });
    expect(bInvite.status).toBe(201);

    for (const [method, path, body] of [
      ['patch', `/store/team/members/${storeB.storeUserId}/role`, { roleKey: 'viewer' }],
      ['delete', `/store/team/members/${storeB.storeUserId}`, {}],
      ['post', `/store/team/invitations/${bInvitationId.id}/revoke`, {}],
    ] as Array<['patch' | 'delete' | 'post', string, object]>) {
      const res = await request(h.baseUrl)[method](path).set(storeA.auth).send(body);
      expectDenied(res.status, res.body, `another store's team via ${method} ${path}`);
    }

    // And nothing moved.
    const bUser = await h.prisma.storeUser.findUniqueOrThrow({
      where: { id: storeB.storeUserId },
      select: { deletedAt: true, role: { select: { key: true } } },
    });
    expect(bUser.deletedAt).toBeNull();
    expect(bUser.role.key).toBe('owner');
    const bInv = await h.prisma.storeUserInvitation.findUniqueOrThrow({
      where: { id: bInvitationId.id },
      select: { deletedAt: true },
    });
    expect(bInv.deletedAt).toBeNull();
  });

  it('a seller cannot read or move another seller’s reseller store', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');

    await request(h.baseUrl)
      .get(`/seller/reseller-stores/${storeA.storeId}`)
      .set(alpha.auth)
      .expect(200);

    const read = await request(h.baseUrl)
      .get(`/seller/reseller-stores/${storeA.storeId}`)
      .set(beta.auth);
    expectDenied(read.status, read.body, "another seller's reseller store");

    const pause = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeA.storeId}/pause`)
      .set(beta.auth)
      .send({});
    expectDenied(pause.status, pause.body, "pausing another seller's reseller store");

    const after = await h.prisma.sellerStore.findUniqueOrThrow({
      where: { id: storeA.storeId },
      select: { status: true },
    });
    expect(after.status).toBe('ACTIVE');
  });

  it('a store token is refused on every seller and admin surface', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');
    for (const path of [
      '/seller/orders',
      '/seller/reseller-stores',
      `/seller/reseller-stores/${storeA.storeId}`,
      '/admin/reseller-stores',
      '/seller/reseller-price-list',
      `/seller/reseller-stores/${storeA.storeId}/catalogue`,
      `/admin/reseller-stores/${storeA.storeId}/catalogue`,
      '/admin/orders',
      '/admin/sellers',
    ]) {
      const res = await request(h.baseUrl).get(path).set(storeA.auth);
      expect([401, 403]).toContain(res.status);
    }
  });

  // ─── Reseller store terms (RS-4) ───────────────────────────────────────
  //
  // The store side takes its store from the token, so the only id a store
  // user can name is a VERSION id — and accepting another store's version
  // must fail at the scoped lookup (and could not be stored anyway: the
  // acceptance's composite FK ties it to its own store's versions). The
  // seller side names a store id, so the question there is the usual one.

  const TERMS_BODY = {
    deliveryFeeStorePercent: '80',
    returnFeeStorePercent: '100',
    customerReturnFeeStorePercent: '100',
    codFeeStorePercent: '0',
    codTaxStorePercent: '100',
    instantPayFeeStorePercent: '100',
    storeCreditTrigger: 'ON_PAYOUT',
    storeCreditDays: 0,
    sellerCreditTrigger: 'ON_PAYOUT',
    sellerCreditDays: 2,
  };

  it('RS-4: a store cannot read or accept another store’s terms', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');
    const storeB = await makeStoreUser(beta, 'store-b');
    await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeA.storeId}/terms`)
      .set(alpha.auth)
      .send(TERMS_BODY)
      .expect(201);
    const bPublished = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeB.storeId}/terms`)
      .set(beta.auth)
      .send(TERMS_BODY)
      .expect(201);
    const bVersionId = (bPublished.body as { current: { id: string } }).current.id;

    // Store A's own view carries only store A's versions.
    const aView = await request(h.baseUrl).get('/store/terms').set(storeA.auth).expect(200);
    expect((aView.body as { storeId: string }).storeId).toBe(storeA.storeId);
    expect(JSON.stringify(aView.body)).not.toContain(bVersionId);
    expect(JSON.stringify(aView.body)).not.toContain(storeB.storeName);

    // Store A accepting store B's version, by id.
    const accept = await request(h.baseUrl)
      .post(`/store/terms/${bVersionId}/accept`)
      .set(storeA.auth)
      .send({});
    expectDenied(accept.status, accept.body, "accepting another store's terms");
    expect(
      await h.prisma.resellerStoreTermsAcceptance.count({ where: { termsVersionId: bVersionId } }),
    ).toBe(0);

    // Store B can — proving the id was real and the denial was the scope.
    await request(h.baseUrl)
      .post(`/store/terms/${bVersionId}/accept`)
      .set(storeB.auth)
      .send({})
      .expect(200);
  });

  it('RS-4: a seller cannot read, preview or publish terms on another seller’s store', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');

    await request(h.baseUrl)
      .get(`/seller/reseller-stores/${storeA.storeId}/terms`)
      .set(alpha.auth)
      .expect(200);

    const read = await request(h.baseUrl)
      .get(`/seller/reseller-stores/${storeA.storeId}/terms`)
      .set(beta.auth);
    expectDenied(read.status, read.body, "another seller's store terms");

    const preview = await request(h.baseUrl)
      .get(`/seller/reseller-stores/${storeA.storeId}/terms/preview`)
      .query({
        deliveryFeeStorePercent: '50',
        returnFeeStorePercent: '50',
        customerReturnFeeStorePercent: '50',
        codFeeStorePercent: '50',
        codTaxStorePercent: '50',
        instantPayFeeStorePercent: '50',
      })
      .set(beta.auth);
    expectDenied(preview.status, preview.body, "previewing another seller's store terms");

    const publish = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeA.storeId}/terms`)
      .set(beta.auth)
      .send(TERMS_BODY);
    expectDenied(publish.status, publish.body, "publishing terms on another seller's store");
    expect(
      await h.prisma.resellerStoreTermsVersion.count({ where: { storeId: storeA.storeId } }),
    ).toBe(0);
  });

  it('a seller or staff token is refused on every store surface', async () => {
    for (const auth of [alpha.auth, staffAuth]) {
      for (const path of [
        '/store/profile',
        '/store/team',
        '/store/catalogue',
        '/store/terms',
        '/auth/store/me',
      ]) {
        const res = await request(h.baseUrl).get(path).set(auth);
        // 401 specifically: the audience check fails before any permission
        // question is asked, and a 404 would mean the path is wrong.
        expect(res.status).toBe(401);
      }
    }
  });

  // ─── Reseller catalogue (RS-3) ─────────────────────────────────────────

  /** A resellable variant (ACTIVE product, ACTIVE variant) owned by `owner`. */
  async function makeVariant(owner: Tenant, label: string): Promise<string> {
    const tag = `${label}-${Math.random().toString(36).slice(2, 8)}`;
    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(owner.auth)
      .send({ name: `${label} product`, externalRef: `EXT-${tag}` })
      .expect(201);
    const productId = (product.body as { id: string }).id;
    await h.prisma.product.update({
      where: { id: productId },
      data: { status: ProductStatus.ACTIVE },
    });
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${productId}/variants`)
      .set(owner.auth)
      .send({ skuCode: `SKU-${tag}` })
      .expect(201);
    return (variant.body as { id: string }).id;
  }

  const PRICE = {
    transferPriceInr: '250.00',
    minRetailInr: '300.00',
    maxRetailInr: '500.00',
    suggestedRetailInr: '399.00',
  };

  it('RS-3: a store sees only its own enabled products, never cost, stock internals or another store', async () => {
    const storeA = await makeStoreUser(alpha, 'cat-a');
    const storeB = await makeStoreUser(beta, 'cat-b');
    const onA = await makeVariant(alpha, 'on');
    const offA = await makeVariant(alpha, 'off');
    const onB = await makeVariant(beta, 'b');

    for (const v of [onA, offA]) {
      await request(h.baseUrl)
        .put(`/seller/reseller-price-list/${v}`)
        .set(alpha.auth)
        .send(PRICE)
        .expect(200);
    }
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeA.storeId}/catalogue/${onA}`)
      .set(alpha.auth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 20 })
      .expect(200);
    await request(h.baseUrl)
      .put(`/seller/reseller-price-list/${onB}`)
      .set(beta.auth)
      // A figure that cannot appear inside another price on store A's
      // response ('99.00' is inside '399.00', A's suggested retail).
      .send({ transferPriceInr: '87.65' })
      .expect(200);
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeB.storeId}/catalogue/${onB}`)
      .set(beta.auth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 })
      .expect(200);

    const cat = await request(h.baseUrl).get('/store/catalogue').set(storeA.auth).expect(200);
    const items = (cat.body as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((i) => i.variantId)).toEqual([onA]);
    expect(items[0]).toMatchObject({ transferPriceInr: '250.00', suggestedRetailInr: '399.00' });
    // Nothing in the warehouse ⇒ nothing to show, never a guess.
    expect(items[0]?.availableQty).toBe(0);
    const text = JSON.stringify(cat.body);
    for (const leak of [offA, onB, storeB.storeName, '87.65']) expect(text).not.toContain(leak);
    for (const key of [
      'hiddenPercent',
      'setAside',
      'onHand',
      'realAvailable',
      'unitCost',
      'stockMode',
    ]) {
      expect(text).not.toContain(key);
    }

    // A set-aside cannot promise stock that is not on hand.
    const over = await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeA.storeId}/catalogue/${onA}`)
      .set(alpha.auth)
      .send({ enabled: true, stockMode: 'SET_ASIDE', setAsideQty: 1, hiddenPercent: 0 });
    expect(over.status).toBe(409);
    expect((over.body as { code: string }).code).toBe('SET_ASIDE_EXCEEDS_STOCK');
  });

  it('RS-3: a seller cannot read or change another seller’s store terms or price list', async () => {
    const storeA = await makeStoreUser(alpha, 'terms-a');
    const vA = await makeVariant(alpha, 'va');
    const vB = await makeVariant(beta, 'vb');
    await request(h.baseUrl)
      .put(`/seller/reseller-price-list/${vA}`)
      .set(alpha.auth)
      .send(PRICE)
      .expect(200);

    const read = await request(h.baseUrl)
      .get(`/seller/reseller-stores/${storeA.storeId}/catalogue`)
      .set(beta.auth);
    expectDenied(read.status, read.body, "another seller's store terms");

    const write = await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeA.storeId}/catalogue/${vA}`)
      .set(beta.auth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 });
    expectDenied(write.status, write.body, "changing another seller's store terms");

    // Alpha can neither hand beta's product to its own store nor price it.
    const foreign = await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeA.storeId}/catalogue/${vB}`)
      .set(alpha.auth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 });
    expectDenied(foreign.status, foreign.body, "another seller's product in a store");
    const price = await request(h.baseUrl)
      .put(`/seller/reseller-price-list/${vB}`)
      .set(alpha.auth)
      .send(PRICE);
    expectDenied(price.status, price.body, "pricing another seller's product");

    expect(await h.prisma.resellerStoreVariant.count({ where: { storeId: storeA.storeId } })).toBe(
      0,
    );
    const betaList = await request(h.baseUrl)
      .get('/seller/reseller-price-list')
      .set(beta.auth)
      .expect(200);
    expect(JSON.stringify(betaList.body)).not.toContain(vA);
  });

  // ─── Reseller store wallets (RS-6) ─────────────────────────────────────

  it('a store sees only its own wallet, and cannot read another store’s top-up proof', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');
    const storeB = await makeStoreUser(beta, 'store-b');
    const account = await h.prisma.platformBankAccount.create({
      data: {
        label: 'HDFC current',
        bankName: 'HDFC Bank',
        accountName: 'Skydrop',
        accountNumber: '50200000000009',
        currency: 'INR',
      },
      select: { id: true },
    });
    const bClaim = await h.prisma.storeTopupRequest.create({
      data: {
        storeId: storeB.storeId,
        sellerId: beta.sellerId,
        bankAccountId: account.id,
        amountInr: '500',
        proofSpacesKey: `stores/${storeB.storeId}/topup-proofs/x.png`,
        proofMimeType: 'image/png',
      },
      select: { id: true },
    });

    const mine = await request(h.baseUrl).get('/store/wallet').set(storeA.auth).expect(200);
    expect((mine.body as { storeId: string }).storeId).toBe(storeA.storeId);
    expect(JSON.stringify(mine.body)).not.toContain(storeB.storeId);

    const claims = await request(h.baseUrl)
      .get('/store/wallet/topups')
      .set(storeA.auth)
      .expect(200);
    expect(JSON.stringify(claims.body)).not.toContain(bClaim.id);

    const proof = await request(h.baseUrl)
      .get(`/store/wallet/topups/${bClaim.id}/proof`)
      .set(storeA.auth);
    expectDenied(proof.status, proof.body, "another store's top-up proof");
  });

  it('a seller cannot read or move money on another seller’s reseller store', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');
    await request(h.baseUrl)
      .get(`/seller/reseller-stores/${storeA.storeId}/wallet`)
      .set(alpha.auth)
      .expect(200);

    for (const [method, path, body] of [
      ['get', `/seller/reseller-stores/${storeA.storeId}/wallet`, {}],
      ['get', `/seller/reseller-stores/${storeA.storeId}/wallet/entries`, {}],
      ['post', `/seller/reseller-stores/${storeA.storeId}/wallet/top-up`, { amountInr: '1.00' }],
      [
        'post',
        `/seller/reseller-stores/${storeA.storeId}/wallet/payouts`,
        { amountInr: '1.00', note: 'Paid by UPI' },
      ],
      [
        'patch',
        `/seller/reseller-stores/${storeA.storeId}/wallet/negative-limit`,
        { negativeLimitInr: '100.00' },
      ],
    ] as const) {
      const res = await request(h.baseUrl)[method](path).set(beta.auth).send(body);
      expectDenied(res.status, res.body, `another seller's store wallet via ${method} ${path}`);
    }
    expect(await h.prisma.storeWalletEntry.count({ where: { storeId: storeA.storeId } })).toBe(0);
    expect(await h.prisma.storeWalletSettings.count({ where: { storeId: storeA.storeId } })).toBe(
      0,
    );
  });

  it('a store token is refused on the seller and admin store-wallet surfaces, and theirs on the store’s', async () => {
    const storeA = await makeStoreUser(alpha, 'store-a');
    for (const path of [
      `/seller/reseller-stores/${storeA.storeId}/wallet`,
      `/admin/reseller-store-wallets/stores/${storeA.storeId}`,
      '/admin/reseller-store-wallets/topups',
    ]) {
      const res = await request(h.baseUrl).get(path).set(storeA.auth);
      expect([401, 403]).toContain(res.status);
    }
    for (const auth of [alpha.auth, staffAuth]) {
      const res = await request(h.baseUrl).get('/store/wallet').set(auth);
      expect(res.status).toBe(401);
    }
  });

  // ─── Reseller store orders (RS-5) ──────────────────────────────────────

  it("RS-5: a store never reaches a sister store's order or customer, and the seller never sees a store customer", async () => {
    // Two stores of the SAME seller — the boundary under test is the store,
    // not the seller.
    const storeA = await makeStoreUser(alpha, 'ord-a');
    const storeB = await makeStoreUser(alpha, 'ord-b');
    const published = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeA.storeId}/terms`)
      .set(alpha.auth)
      .send({
        deliveryFeeStorePercent: '80',
        returnFeeStorePercent: '100',
        customerReturnFeeStorePercent: '100',
        codFeeStorePercent: '0',
        codTaxStorePercent: '100',
        instantPayFeeStorePercent: '100',
        storeCreditTrigger: 'ON_PAYOUT',
        storeCreditDays: 0,
        sellerCreditTrigger: 'ON_PAYOUT',
        sellerCreditDays: 0,
        basedOnVersion: 0,
      })
      .expect(201);
    const termsVersionId = (published.body as { current: { id: string } }).current.id;

    // Seeded directly: the READS are under test.
    const customer = await h.prisma.customer.create({
      data: {
        sellerId: alpha.sellerId,
        resellerStoreId: storeA.storeId,
        phoneE164: '+919876500031',
        name: 'Priya Store-Customer',
        email: 'priya@example.com',
      },
      select: { id: true },
    });
    const order = await h.prisma.order.create({
      data: {
        sellerId: alpha.sellerId,
        storeId: storeA.storeId,
        storeKind: 'RESELLER',
        storeNameSnapshot: storeA.storeName,
        customerId: customer.id,
        orderNumber: `SD-2026-95-${Math.floor(Math.random() * 900000 + 100000)}`,
        status: 'PENDING_CONFIRMATION',
        paymentMode: 'COD',
        codAmountInr: '499.00',
        recipientName: 'Priya Store-Customer',
        recipientPhoneE164: '+919876500031',
        recipientEmail: 'priya@example.com',
        recipientAddressLine1: '44 Hidden Lane',
        recipientAddressLine2: 'Behind the temple',
        recipientCity: 'Pune',
        recipientStateProvince: 'Maharashtra',
        recipientPostalCode: '411001',
        recipientCountryCode: 'IN',
        declaredValueInr: '0.00',
        resellerTermsVersionId: termsVersionId,
        resellerDeliveryFeeStorePercent: '80',
        resellerReturnFeeStorePercent: '100',
        resellerCustomerReturnFeeStorePercent: '100',
        resellerCodFeeStorePercent: '0',
        resellerCodTaxStorePercent: '100',
        resellerInstantPayFeeStorePercent: '100',
        resellerStoreCreditTrigger: 'ON_PAYOUT',
        resellerStoreCreditDays: 0,
        resellerSellerCreditTrigger: 'ON_PAYOUT',
        resellerSellerCreditDays: 0,
      },
      select: { id: true },
    });

    // Store A sees its own — the ids are real, so the denials below are denials.
    await request(h.baseUrl).get(`/store/orders/${order.id}`).set(storeA.auth).expect(200);
    await request(h.baseUrl).get(`/store/customers/${customer.id}`).set(storeA.auth).expect(200);

    const bOrder = await request(h.baseUrl).get(`/store/orders/${order.id}`).set(storeB.auth);
    expectDenied(bOrder.status, bOrder.body, "a sister store's order");
    const bCustomer = await request(h.baseUrl)
      .get(`/store/customers/${customer.id}`)
      .set(storeB.auth);
    expectDenied(bCustomer.status, bCustomer.body, "a sister store's customer");
    const bList = await request(h.baseUrl).get('/store/orders').set(storeB.auth).expect(200);
    expect(JSON.stringify(bList.body)).not.toContain(order.id);

    // Store B's API key is no key to store A's orders.
    const key = await request(h.baseUrl)
      .post('/store/api-keys')
      .set(storeB.auth)
      .send({ name: 'B integration' })
      .expect(201);
    const apiAuth = { Authorization: `Bearer ${(key.body as { plaintext: string }).plaintext}` };
    await request(h.baseUrl).get('/store-api/v1/orders').set(apiAuth).expect(200);
    const viaKey = await request(h.baseUrl).get(`/store-api/v1/orders/${order.id}`).set(apiAuth);
    expectDenied(viaKey.status, viaKey.body, "a sister store's order via an API key");

    // The seller sees the order is theirs — and never who it goes to.
    const seen = await request(h.baseUrl)
      .get(`/seller/orders/${order.id}`)
      .set(alpha.auth)
      .expect(200);
    expect((seen.body as { recipientMasked: boolean }).recipientMasked).toBe(true);
    const text = JSON.stringify(seen.body);
    expect(text).not.toContain('Priya');
    expect(text).not.toContain('9876500031');
    expect(text).not.toContain('priya@example.com');
    expect(text).not.toContain('Hidden Lane');
    const byPhone = await request(h.baseUrl)
      .get('/seller/orders?search=9876500031')
      .set(alpha.auth)
      .expect(200);
    expect((byPhone.body as { total: number }).total).toBe(0);
    const customers = await request(h.baseUrl).get('/seller/customers').set(alpha.auth).expect(200);
    expect(JSON.stringify(customers.body)).not.toContain(customer.id);
    const direct = await request(h.baseUrl).get(`/seller/customers/${customer.id}`).set(alpha.auth);
    expectDenied(direct.status, direct.body, "a store's customer from the seller side");
  });
});
