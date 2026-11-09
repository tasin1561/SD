import request from 'supertest';
import { ActorType } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Order page v2 — `OrderService.linkAddressCheckAsync`, against a real
 * database.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ───────────────────────────────────
 * The whole of the behaviour is a GUARDED `updateMany`:
 *
 *   where: { referenceId, sellerId, orderId: null }
 *
 * Every rule it enforces — one seller cannot claim another's check, a
 * check already pointing at an order is not re-pointed, an unknown
 * reference is a no-op — lives in that WHERE clause, and a mocked
 * prisma would only ever replay whatever the mock was told to return.
 * Only Postgres evaluates the clause, so only an e2e proves it. Until
 * this spec existed the method had no test of any kind.
 *
 * ── WHY NO POLLING ───────────────────────────────────────────────────
 * Despite the `Async` in its name, `create` AWAITS the link before it
 * returns, so the 201 is proof the claim has already been attempted.
 * That is what lets the refusal cases assert "still null" with no sleep
 * and no flake: there is no window left in which the link could still
 * arrive. If the call is ever made genuinely fire-and-forget, cases 2,
 * 3 and 5 below become racy and must grow a `waitFor` — which is the
 * right alarm to have attached to that change.
 *
 * ── WHY THE CHECK ROW IS SEEDED DIRECTLY ─────────────────────────────
 * A real check row is minted by the order page calling Solustation, an
 * external HTTP service with no e2e double. The subject here is the
 * LINK, not how the row came to exist, so the fixture writes the row
 * the page would have left behind and the spec drives the order through
 * the real HTTP surface.
 */
describe('Address check → order link (e2e)', () => {
  interface SellerFixture {
    id: string;
    auth: { Authorization: string };
    ownerUserId: string | null;
    variantId: string;
  }

  let h: AppHarness;
  let staffAuth: { Authorization: string };
  /** The seller who filled in the address, and owns the check. */
  let s: SellerFixture;
  /** Another seller entirely, who knows the reference id. */
  let t: SellerFixture;

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
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    s = await registerSeller('acheck-s', 'Acheck Brand S', '+8801712345801');
    t = await registerSeller('acheck-t', 'Acheck Brand T', '+8801712345802');
  });

  async function registerSeller(
    slug: string,
    companyName: string,
    phone: string,
  ): Promise<SellerFixture> {
    const email = `${slug}-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName,
        contactPersonName: `${companyName} Owner`,
        phone,
        password: 'SellerPass-1234',
      })
      .expect(201);
    const id = reg.body.seller.id as string;
    const auth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(auth)
      .send({ name: 'Widget', externalRef: `${slug}-W-1` })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(auth)
      .send({ skuCode: `${slug.toUpperCase()}-W-1-STD` })
      .expect(201);

    // The person at the screen when the draft was opened. Read rather
    // than invented so the fixture row says something true; the link
    // guard does not read it, which is the point of asserting it is
    // left alone below.
    const owner = await h.prisma.sellerUser.findFirst({
      where: { sellerId: id },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      id,
      auth,
      ownerUserId: owner?.id ?? null,
      variantId: variant.body.id as string,
    };
  }

  /** The row the order page leaves behind once Solustation has answered. */
  async function seedDraftCheck(
    seller: SellerFixture,
    referenceId: string,
  ): Promise<{
    status: string;
    action: string | null;
    score: number | null;
    poConfidence: string | null;
    validationId: string | null;
  }> {
    const row = await h.prisma.addressCheck.create({
      data: {
        referenceId,
        // Keyed on the draft, not the order (schema comment): the check
        // happened minutes before anything was saved.
        orderId: null,
        sellerId: seller.id,
        createdByActorType: ActorType.SELLER,
        createdByActorId: seller.ownerUserId,
        validationId: `sol-${referenceId.slice(6, 14)}`,
        status: 'needs_review',
        action: 'confirm_with_customer',
        score: 62,
        poConfidence: 'medium',
        result: { status: 'needs_review', score: 62 },
        checkedAt: new Date(),
      },
      select: {
        status: true,
        action: true,
        score: true,
        poConfidence: true,
        validationId: true,
      },
    });
    return row;
  }

  function createOrderBody(
    variantId: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      recipientName: 'Asha Verma',
      recipientPhoneE164: '+919876543210',
      // Fixture: several orders for one customer on purpose (case 3).
      acknowledgeDuplicate: true,
      recipientAddressLine1: '12 MG Road',
      recipientAddressLine2: 'Near City Hospital',
      recipientCity: 'Bengaluru',
      recipientStateProvince: 'Karnataka',
      recipientPostalCode: '560001',
      paymentMode: 'COD',
      codAmountInr: 999,
      items: [{ variantId, quantity: 1 }],
      ...extra,
    };
  }

  async function placeOrder(
    seller: SellerFixture,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(h.baseUrl)
      .post('/seller/orders')
      .set(seller.auth)
      .send(createOrderBody(seller.variantId, extra))
      .expect(201);
    return res.body.id as string;
  }

  // ── 1. The happy path ───────────────────────────────────────────────
  it('claims the draft check for the order it produced, and changes nothing else on it', async () => {
    const referenceId = 'draft-7b1c9e20-aaaa-4aaa-8aaa-000000000001';
    const before = await seedDraftCheck(s, referenceId);

    const orderId = await placeOrder(s, { addressCheckReferenceId: referenceId });

    const row = await h.prisma.addressCheck.findUniqueOrThrow({
      where: { referenceId },
    });
    expect(row.orderId).toBe(orderId);

    // The JUDGEMENT is untouched: the link writes `order_id` and nothing
    // else. A claim that also re-wrote the verdict would make the row
    // useless as a record of what was actually shown to the operator.
    expect(row.status).toBe(before.status);
    expect(row.action).toBe(before.action);
    expect(row.score).toBe(before.score);
    expect(row.poConfidence).toBe(before.poConfidence);
    expect(row.validationId).toBe(before.validationId);
    expect(row.sellerId).toBe(s.id);
    expect(row.createdByActorId).toBe(s.ownerUserId);

    // The reference's PRESENCE is what marks the order as v2 — there is
    // no second field the two order pages could disagree about.
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.createdVia).toBe('order_page_v2');
    expect(order.sellerId).toBe(s.id);
  });

  // ── 2. Another seller cannot steal it ───────────────────────────────
  it('refuses a reference belonging to another seller, and still saves that seller’s order', async () => {
    const referenceId = 'draft-7b1c9e20-bbbb-4bbb-8bbb-000000000002';
    await seedDraftCheck(s, referenceId);

    // T quotes a reference they could only have guessed or been given.
    // A reference id is not a secret, which is exactly why `sellerId` is
    // in the WHERE clause.
    const theirOrderId = await placeOrder(t, { addressCheckReferenceId: referenceId });

    const row = await h.prisma.addressCheck.findUniqueOrThrow({
      where: { referenceId },
    });
    expect(row.orderId).toBeNull();
    expect(row.sellerId).toBe(s.id);

    // T's order is created normally — the refusal is silent, because an
    // order must never fail to save over the bookkeeping of its advice.
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: theirOrderId } });
    expect(order.sellerId).toBe(t.id);
    expect(order.createdVia).toBe('order_page_v2');

    // And T did not get a check of their own by way of consolation.
    expect(await h.prisma.addressCheck.count({ where: { sellerId: t.id } })).toBe(0);
    expect(await h.prisma.addressCheck.count()).toBe(1);
  });

  // ── 3. An already-claimed check is not re-claimed ───────────────────
  it('leaves an already-claimed check pointing at the FIRST order', async () => {
    const referenceId = 'draft-7b1c9e20-cccc-4ccc-8ccc-000000000003';
    await seedDraftCheck(s, referenceId);

    const firstOrderId = await placeOrder(s, { addressCheckReferenceId: referenceId });
    // A page reopened from browser history carries the same draft id.
    const secondOrderId = await placeOrder(s, { addressCheckReferenceId: referenceId });
    expect(secondOrderId).not.toBe(firstOrderId);

    const row = await h.prisma.addressCheck.findUniqueOrThrow({
      where: { referenceId },
    });
    expect(row.orderId).toBe(firstOrderId);

    // The second order simply has no check, which is true — and there is
    // no second row inventing one for it.
    expect(await h.prisma.addressCheck.count()).toBe(1);
    const second = await h.prisma.order.findUniqueOrThrow({ where: { id: secondOrderId } });
    expect(second.createdVia).toBe('order_page_v2');
  });

  // ── 4. A reference that matches nothing ─────────────────────────────
  it('creates the order when the reference names no check at all', async () => {
    const referenceId = 'draft-7b1c9e20-dddd-4ddd-8ddd-000000000004';
    // Deliberately NOT seeded: a draft whose check never completed.

    const orderId = await placeOrder(s, { addressCheckReferenceId: referenceId });

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.createdVia).toBe('order_page_v2');

    // No row is invented for an unknown reference. The link is a claim
    // on something that already exists, never an insert.
    expect(await h.prisma.addressCheck.count()).toBe(0);
  });

  // ── 5. No reference at all (the v1 order page) ──────────────────────
  it('touches no check row when the order carries no reference', async () => {
    const referenceId = 'draft-7b1c9e20-eeee-4eee-8eee-000000000005';
    await seedDraftCheck(s, referenceId);

    const orderId = await placeOrder(s);

    const row = await h.prisma.addressCheck.findUniqueOrThrow({
      where: { referenceId },
    });
    expect(row.orderId).toBeNull();

    // The old page sends no reference and behaves exactly as it always
    // has: `created_via` is null, which is what every order ever placed
    // before v2 has.
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.createdVia).toBeNull();
  });
});
