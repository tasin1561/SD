import request from 'supertest';
import { OrderStatus } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Knowing who you are shipping to.
 *
 * Two things are being proven here, and the second one is the subtle
 * one.
 *
 * The counts are PLATFORM-WIDE: a customer who has refused parcels from
 * four sellers is exactly who the fifth needs warning about, and
 * per-seller history would tell them nothing until they had been burned
 * themselves. Risk is a property of the customer.
 *
 * The duplicate WARNING is per-seller: seller A's unpacked order must
 * not warn seller B about a customer they happen to share. That falls
 * out of the query being seller-scoped rather than from a rule — B never
 * sees A's rows — and this asserts it, because "it happens to work" and
 * "it cannot break" are different properties.
 */
describe('Customer history + duplicate warning (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerA: { Authorization: string };
  let sellerB: { Authorization: string };
  let variantA: string;
  let variantB: string;

  const PHONE = '+919876500011';

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  async function makeSeller(
    tag: string,
    phone: string,
  ): Promise<{ auth: { Authorization: string }; variantId: string }> {
    const email = `${tag}-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: `${tag} Brand`,
        contactPersonName: `${tag} Owner`,
        phone,
        password: 'SellerPass-1234',
      })
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(auth)
      .send({ name: `${tag} Widget`, externalRef: `${tag}-1` })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(auth)
      .send({ skuCode: `${tag}-1-STD`, weightGrams: 500, declaredValueInr: 500 })
      .expect(201);
    return { auth, variantId: variant.body.id as string };
  }

  function orderBody(variantId: string, overrides: Record<string, unknown> = {}) {
    return {
      recipientName: 'Repeat Customer',
      recipientPhoneE164: PHONE,
      recipientAddressLine1: '12 Test Road',
      recipientCity: 'New Delhi',
      recipientStateProvince: 'Delhi',
      recipientPostalCode: '110001',
      paymentMode: 'COD',
      codAmountInr: 500,
      items: [{ variantId, quantity: 1 }],
      ...overrides,
    };
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma);
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const a = await makeSeller('sellerA', '+8801712345671');
    const b = await makeSeller('sellerB', '+8801712345672');
    sellerA = a.auth;
    sellerB = b.auth;
    variantA = a.variantId;
    variantB = b.variantId;
  });

  it('a first-time number returns an empty history rather than an error', async () => {
    const res = await request(h.baseUrl)
      .get(`/seller/orders/customer-lookup?phoneE164=${encodeURIComponent(PHONE)}`)
      .set(sellerA)
      .expect(200);
    expect(res.body.platform).toMatchObject({ totalOrders: 0, delivered: 0, returned: 0 });
    // A rate off zero orders is not a rate.
    expect(res.body.platform.returnRatePercent).toBeNull();
    expect(res.body.yours.openOrders).toEqual([]);
  });

  it('warns on a second unpacked order, and says WHICH order it would duplicate', async () => {
    const first = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);

    const dup = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_ORDER_SUSPECTED');
    // The seller has to SEE what they would be duplicating — the
    // decision is "is this the same order?", which a count cannot answer.
    expect(dup.body.details.existingOrders).toHaveLength(1);
    expect(dup.body.details.existingOrders[0]).toMatchObject({
      orderNumber: first.body.orderNumber,
      // Same SKU: almost certainly a double-entry rather than a genuine
      // second purchase.
      sharesItems: true,
    });
  });

  it('lets the seller through when they say they meant it, and records that they did', async () => {
    await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);

    const second = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA, { acknowledgeDuplicate: true }))
      .expect(201);

    // Recorded, not merely honoured: without this there is no answer the
    // first time a seller disputes two delivery fees for "one order".
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: second.body.id } });
    expect(row.duplicateAcknowledgedAt).toBeInstanceOf(Date);
  });

  it("seller A's unpacked order does NOT warn seller B", async () => {
    await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);

    // Same customer, different seller — no warning, because B's query
    // never sees A's rows. This is the property that makes the feature
    // safe to have at all.
    await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerB)
      .send(orderBody(variantB))
      .expect(201);
  });

  it('a PACKED order stops warning — the box is made up and cannot be consolidated', async () => {
    const first = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);

    await h.prisma.order.update({
      where: { id: first.body.id },
      data: { status: OrderStatus.PACKED },
    });

    await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);
  });

  it('a cancelled order is dead, not pending, and must not warn', async () => {
    const first = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);
    await h.prisma.order.update({
      where: { id: first.body.id },
      data: { status: OrderStatus.CANCELLED },
    });

    await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);
  });

  it('counts span every seller, but the order list does not', async () => {
    await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerA)
      .send(orderBody(variantA))
      .expect(201);
    await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerB)
      .send(orderBody(variantB))
      .expect(201);

    const res = await request(h.baseUrl)
      .get(`/seller/orders/customer-lookup?phoneE164=${encodeURIComponent(PHONE)}`)
      .set(sellerA)
      .expect(200);

    // A sees BOTH orders in the aggregate — the risk belongs to the
    // customer, and A shipping blind to a serial refuser helps nobody.
    expect(res.body.platform.totalOrders).toBe(2);
    // ...and only their OWN in the detail. A does not learn that B sells
    // to this person, what B sold, or for how much.
    expect(res.body.yours.totalOrders).toBe(1);
    expect(res.body.yours.recentOrders).toHaveLength(1);
  });

  it('rejects a phone that is not E.164 rather than silently matching nothing', async () => {
    // A seller typing a local format and getting a confident "no history"
    // is the failure mode worth being loud about.
    await request(h.baseUrl)
      .get('/seller/orders/customer-lookup?phoneE164=01819912939')
      .set(sellerA)
      .expect(400);
  });
});
