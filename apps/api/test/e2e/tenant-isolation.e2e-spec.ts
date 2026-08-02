import request from 'supertest';
import { SellerStatus, StaffRole } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
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
    const order = await h.prisma.order.create({
      data: {
        sellerId: alpha.sellerId,
        orderNumber: `SD-2026-99-${Math.floor(Math.random() * 900000 + 100000)}`,
        status: 'PENDING_CONFIRMATION',
        paymentMode: 'PREPAID',
        recipientName: 'Alpha Customer',
        recipientPhoneE164: '+919812345678',
        recipientAddressLine1: '1 Private Road',
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
    const order = await h.prisma.order.create({
      data: {
        orderNumber: `SD-2026-99-${Date.now().toString().slice(-6)}`,
        sellerId: alpha.sellerId,
        recipientName: 'Alpha Customer',
        recipientPhoneE164: '+919876500098',
        recipientAddressLine1: 'a',
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
});
