import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { SellerStatus, StaffRole } from '@skydrop/db';
import { ResellerStoreTermsService } from '../../src/modules/reseller-store-terms/services/reseller-store-terms.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * RS-4 — reseller store terms, against a real database.
 *
 * The unit specs pin the arithmetic and the rules; this pins what only
 * Postgres can show: two publishes at once never share a version number
 * (the advisory lock, backed by the unique), a new version supersedes the
 * store's acceptance, the CHECKs hold, and the credit-after-confirmation
 * switch is reachable through its own endpoint and nowhere else.
 */
describe('reseller store terms (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let seller: { sellerId: string; auth: { Authorization: string } };

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
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@terms.test`;
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

  /** Opens a store with its first user, and signs that user in (see tenant-isolation). */
  async function makeStore(label: string): Promise<{
    storeId: string;
    auth: { Authorization: string };
  }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(seller.auth)
      .send({
        name: `${label} ${Math.random().toString(36).slice(2, 8)}`,
        contactEmail: email,
        contactPhone: '+919800000002',
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
    return {
      storeId,
      auth: { Authorization: `Bearer ${(accepted.body as { accessToken: string }).accessToken}` },
    };
  }

  function terms(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
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
      ...overrides,
    };
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
    seller = await makeSeller('terms');

    // PRC-8: the global fees are agreed in TAKA, so the worked example a
    // store sees is a CONVERTED figure. This spec is about publishing,
    // accepting and superseding terms — not about conversion — so the
    // seller is pinned to INR and the example stays the round ₹200 the
    // split assertions are written against. The taka path is covered in
    // warehouse-rto-flow.
    for (const key of [
      'pricing.flat_delivery_fee_currency',
      'pricing.flat_rto_fee_currency',
      'pricing.customer_return_fee_currency',
    ]) {
      await request(h.baseUrl)
        .patch(`/admin/sellers/${seller.sellerId}/settings/${key}`)
        .set(staffAuth)
        .send({ valueType: 'STRING', value: 'INR', note: 'Spec pins the fee currency' })
        .expect(200);
    }
  });

  it('publish → accept → a new version supersedes the acceptance', async () => {
    const store = await makeStore('flow');
    const svc = h.app.get(ResellerStoreTermsService, { strict: false });

    expect((await svc.orderReadiness(store.storeId)).reasons).toEqual(['NO_TERMS']);

    const v1 = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${store.storeId}/terms`)
      .set(seller.auth)
      .send(terms({ basedOnVersion: 0 }))
      .expect(201);
    const v1Id = (v1.body as { current: { id: string; version: number } }).current.id;
    expect((v1.body as { current: { version: number } }).current.version).toBe(1);
    // The worked example is the API's arithmetic: 80% of the ₹200 seeded fee.
    const delivery = (
      v1.body as { examples: Array<{ feeType: string; storeInr: string; sellerInr: string }> }
    ).examples.find((e) => e.feeType === 'DELIVERY_FEE');
    expect(delivery).toMatchObject({ storeInr: '160.00', sellerInr: '40.00' });

    expect((await svc.orderReadiness(store.storeId)).reasons).toEqual(['TERMS_NOT_ACCEPTED']);
    const view = await request(h.baseUrl).get('/store/terms').set(store.auth).expect(200);
    expect((view.body as { currentAccepted: boolean }).currentAccepted).toBe(false);

    await request(h.baseUrl)
      .post(`/store/terms/${v1Id}/accept`)
      .set(store.auth)
      .send({})
      .expect(200);
    // A second click is not a second acceptance.
    await request(h.baseUrl)
      .post(`/store/terms/${v1Id}/accept`)
      .set(store.auth)
      .send({})
      .expect(200);
    expect(
      await h.prisma.resellerStoreTermsAcceptance.count({ where: { storeId: store.storeId } }),
    ).toBe(1);
    expect(await svc.acceptedCurrentTerms(store.storeId)).toBe(true);
    expect((await svc.orderReadiness(store.storeId)).ready).toBe(true);

    // Stale edit, and nothing-changed, are both refused.
    await request(h.baseUrl)
      .post(`/seller/reseller-stores/${store.storeId}/terms`)
      .set(seller.auth)
      .send(terms({ basedOnVersion: 0, deliveryFeeStorePercent: '50' }))
      .expect(409);
    await request(h.baseUrl)
      .post(`/seller/reseller-stores/${store.storeId}/terms`)
      .set(seller.auth)
      .send(terms())
      .expect(409);

    const v2 = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${store.storeId}/terms`)
      .set(seller.auth)
      .send(terms({ basedOnVersion: 1, deliveryFeeStorePercent: '50' }))
      .expect(201);
    expect((v2.body as { current: { version: number } }).current.version).toBe(2);
    expect(await svc.acceptedCurrentTerms(store.storeId)).toBe(false);

    // The old version can no longer be accepted; the new one can.
    await request(h.baseUrl)
      .post(`/store/terms/${v1Id}/accept`)
      .set(store.auth)
      .send({})
      .expect(409);
    const v2Id = (v2.body as { current: { id: string } }).current.id;
    await request(h.baseUrl)
      .post(`/store/terms/${v2Id}/accept`)
      .set(store.auth)
      .send({})
      .expect(200);
    expect(await svc.acceptedCurrentTerms(store.storeId)).toBe(true);

    // Published versions are never rewritten: v1 still reads 80%.
    const v1Row = await h.prisma.resellerStoreTermsVersion.findUniqueOrThrow({
      where: { id: v1Id },
    });
    expect(v1Row.deliveryFeeStorePercent.toFixed(2)).toBe('80.00');
  });

  it('concurrent publishes get distinct version numbers', async () => {
    const store = await makeStore('race');
    const results = await Promise.all(
      [10, 20, 30, 40, 50].map((pct) =>
        request(h.baseUrl)
          .post(`/seller/reseller-stores/${store.storeId}/terms`)
          .set(seller.auth)
          .send(terms({ deliveryFeeStorePercent: String(pct) })),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    const rows = await h.prisma.resellerStoreTermsVersion.findMany({
      where: { storeId: store.storeId },
      select: { version: true },
      orderBy: { version: 'asc' },
    });
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it('the database refuses a share above 100% and INSTANT with days', async () => {
    const store = await makeStore('checks');
    const base = {
      storeId: store.storeId,
      version: 1,
      deliveryFeeStorePercent: '100.01',
      returnFeeStorePercent: '0',
      customerReturnFeeStorePercent: '0',
      codFeeStorePercent: '0',
      codTaxStorePercent: '0',
      instantPayFeeStorePercent: '0',
      storeCreditTrigger: 'ON_PAYOUT' as const,
      storeCreditDays: 0,
      sellerCreditTrigger: 'ON_PAYOUT' as const,
      sellerCreditDays: 0,
      createdByActorType: 'SELLER' as const,
    };
    await expect(h.prisma.resellerStoreTermsVersion.create({ data: base })).rejects.toThrow();
    await expect(
      h.prisma.resellerStoreTermsVersion.create({
        data: {
          ...base,
          deliveryFeeStorePercent: '10',
          storeCreditTrigger: 'INSTANT',
          storeCreditDays: 3,
        },
      }),
    ).rejects.toThrow();
  });

  it('credit after confirmation: refused until Skydrop enables it, flagged when switched off', async () => {
    const store = await makeStore('ac');
    const afterConfirmation = terms({
      storeCreditTrigger: 'AFTER_CONFIRMATION',
      storeCreditDays: 2,
    });

    const refused = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${store.storeId}/terms`)
      .set(seller.auth)
      .send(afterConfirmation)
      .expect(409);
    expect((refused.body as { code: string }).code).toBe('CREDIT_AFTER_CONFIRMATION_NOT_ENABLED');

    // The generic per-seller settings door is closed for this key.
    const generic = await request(h.baseUrl)
      .patch(
        `/admin/sellers/${seller.sellerId}/settings/reseller.credit_after_confirmation_enabled`,
      )
      .set(staffAuth)
      .send({ valueType: 'BOOLEAN', value: true });
    expect(generic.status).toBe(409);
    expect((generic.body as { code: string }).code).toBe('SETTING_HAS_DEDICATED_ENDPOINT');

    await request(h.baseUrl)
      .put(`/admin/sellers/${seller.sellerId}/reseller-credit-after-confirmation`)
      .set(staffAuth)
      .send({ enabled: true, reason: 'Trusted seller, agreed with the owner on the call.' })
      .expect(200);
    const published = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${store.storeId}/terms`)
      .set(seller.auth)
      .send(afterConfirmation)
      .expect(201);
    const versionId = (published.body as { current: { id: string } }).current.id;
    await request(h.baseUrl)
      .post(`/store/terms/${versionId}/accept`)
      .set(store.auth)
      .send({})
      .expect(200);
    const svc = h.app.get(ResellerStoreTermsService, { strict: false });
    expect((await svc.orderReadiness(store.storeId)).ready).toBe(true);

    const off = await request(h.baseUrl)
      .put(`/admin/sellers/${seller.sellerId}/reseller-credit-after-confirmation`)
      .set(staffAuth)
      .send({ enabled: false, reason: 'Risk review: fronting paused for this seller.' })
      .expect(200);
    expect((off.body as { flaggedStores: Array<{ storeId: string }> }).flaggedStores).toEqual([
      expect.objectContaining({ storeId: store.storeId }),
    ]);
    // Nothing was rewritten: the version still says AFTER_CONFIRMATION.
    const row = await h.prisma.resellerStoreTermsVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    expect(row.storeCreditTrigger).toBe('AFTER_CONFIRMATION');
    expect((await svc.orderReadiness(store.storeId)).reasons).toEqual([
      'AFTER_CONFIRMATION_NOT_ENABLED',
    ]);
    const view = await request(h.baseUrl)
      .get(`/seller/reseller-stores/${store.storeId}/terms`)
      .set(seller.auth)
      .expect(200);
    expect((view.body as { needsRevision: string | null }).needsRevision).not.toBeNull();
  });
});
