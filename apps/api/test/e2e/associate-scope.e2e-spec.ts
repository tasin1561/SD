import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { ProductStatus, SellerStatus, StaffRoleKey } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * ASSOC-1 — the narrowing, against a real database.
 *
 * ── WHY THIS SPEC EXISTS AND THE UNIT ONES ARE NOT ENOUGH ────────────
 * `associate-order-scope.spec.ts` asserts on the `where` handed to a
 * MOCKED Prisma, which is the only thing a mock can show. It cannot show
 * that the clause actually EXCLUDES the row — a mock has no WHERE engine,
 * so a filter that names the wrong column, or one Prisma silently drops
 * because the relation is spelled differently, passes there and leaks
 * here. The same lesson as the pack-box and pickup-request partial
 * uniques: only Postgres proves a query.
 *
 * Two associates at one store is the shape to drive, because every
 * interesting failure is "A can see B's" — which a single-user test
 * cannot even express.
 */
describe('associate scope (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerId: string;
  let sellerAuth: { Authorization: string };
  let variantId: string;
  let binId: string;
  let storeId: string;
  let ownerAuth: { Authorization: string };

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  /** Accept a pending invitation of this store's and sign the person in. */
  async function acceptInvite(
    label: string,
  ): Promise<{ auth: { Authorization: string }; storeUserId: string }> {
    const invitation = await h.prisma.storeUserInvitation.findFirstOrThrow({
      where: { storeId, usedAt: null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const plaintext = `e2e-invite-${randomBytes(24).toString('hex')}`;
    await h.prisma.storeUserInvitation.update({
      where: { id: invitation.id },
      data: { token: createHash('sha256').update(plaintext, 'utf8').digest('hex') },
    });
    const accepted = await request(h.baseUrl)
      .post('/auth/store/invitations/accept')
      .send({ token: plaintext, password: 'StorePass-1234', fullName: label })
      .expect(201);
    const body = accepted.body as { accessToken: string };
    const auth = { Authorization: `Bearer ${body.accessToken}` };
    const me = await request(h.baseUrl).get('/auth/store/me').set(auth).expect(200);
    return { auth, storeUserId: (me.body as { id: string }).id };
  }

  /** One of the store's own people, on the `associate` role (OWN scope). */
  async function makeAssociate(
    label: string,
    email: string,
  ): Promise<{ auth: { Authorization: string }; storeUserId: string }> {
    await request(h.baseUrl)
      .post('/store/team/invitations')
      .set(ownerAuth)
      .send({ email, fullName: label, roleKeys: ['associate'] })
      .expect(201);
    return acceptInvite(label);
  }

  /** What this person sells the variant at. Set by the owner, per person. */
  async function priceFor(storeUserId: string, retail: string): Promise<void> {
    await request(h.baseUrl)
      .put(`/store/associates/${storeUserId}/prices/${variantId}`)
      .set(ownerAuth)
      .send({ retailPriceInr: retail })
      .expect(200);
  }

  function order(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      recipientName: 'Asha Verma',
      recipientPhoneE164: '+919876500001',
      recipientAddressLine1: '12 MG Road',
      recipientAddressLine2: 'Near City Hospital',
      recipientPostalCode: '560001',
      paymentMode: 'COD',
      acknowledgeDuplicate: true,
      items: [{ variantId, quantity: 1 }],
      ...over,
    };
  }

  async function place(
    auth: { Authorization: string },
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const created = await request(h.baseUrl)
      .post('/store/orders')
      .set(auth)
      .send(order(over))
      .expect(201);
    return (created.body as { id: string }).id;
  }

  async function receiveStock(qty: number): Promise<void> {
    const gr = await request(h.baseUrl)
      .post('/seller/goods-receipts')
      .set(sellerAuth)
      .send({ lines: [{ variantId, expectedQty: qty }] })
      .expect(201);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/start-receiving`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/lines`)
      .set(staffAuth)
      .send({ lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }] })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma, { role: StaffRoleKey.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const sellerEmail = `assoc-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email: sellerEmail })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Assoc Brand',
        contactPersonName: 'Assoc Owner',
        phone: '+8801712345602',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
    await h.prisma.seller.update({
      where: { id: sellerId },
      data: { status: SellerStatus.APPROVED },
    });
    const sLogin = await request(h.baseUrl)
      .post('/auth/seller/login')
      .send({ email: sellerEmail, password: 'SellerPass-1234' })
      .expect(200);
    sellerAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    // A warehouse bin to receive into.
    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    const warehouseId = (whs.body as Array<{ id: string; code: string }>).find(
      (w) => w.code === 'CCU-01',
    )?.id;
    expect(warehouseId).toBeDefined();
    const zone = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/zones`)
      .set(staffAuth)
      .send({ code: 'A', name: 'Zone A' })
      .expect(201);
    const bin = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId: zone.body.id, aisle: 'A', rack: '1', shelf: '1', type: 'STORAGE' })
      .expect(201);
    binId = bin.body.id as string;

    // A resellable variant, priced for stores.
    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Kurta', externalRef: 'K-1' })
      .expect(201);
    await h.prisma.product.update({
      where: { id: product.body.id as string },
      data: { status: ProductStatus.ACTIVE },
    });
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'K-1-M' })
      .expect(201);
    variantId = variant.body.id as string;
    await request(h.baseUrl)
      .put(`/seller/reseller-price-list/${variantId}`)
      .set(sellerAuth)
      .send({
        transferPriceInr: '300.00',
        minRetailInr: '400.00',
        maxRetailInr: '600.00',
        suggestedRetailInr: '499.00',
      })
      .expect(200);

    // The store, its owner signed in, terms published and accepted.
    const storeEmail = `store-${Date.now()}-${Math.random().toString(36).slice(2)}@scope.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(sellerAuth)
      .send({
        name: `Scope Shop ${Math.random().toString(36).slice(2, 8)}`,
        displayName: 'Scope Shop',
        contactEmail: storeEmail,
        contactPhone: '+919800000005',
        invite: { email: storeEmail, fullName: 'Shop Owner', roleKeys: ['owner'] },
      })
      .expect(201);
    storeId = (created.body as { id: string }).id;
    ownerAuth = (await acceptInvite('Shop Owner')).auth;

    const published = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeId}/terms`)
      .set(sellerAuth)
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
    await request(h.baseUrl)
      .post(`/store/terms/${(published.body as { current: { id: string } }).current.id}/accept`)
      .set(ownerAuth)
      .send({})
      .expect(200);

    // The product, offered to the store, and stock behind it.
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeId}/catalogue/${variantId}`)
      .set(sellerAuth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 })
      .expect(200);
    await receiveStock(20);
    await request(h.baseUrl)
      .patch(`/admin/sellers/${sellerId}/settings/reseller.orders_enabled`)
      .set(staffAuth)
      .send({ valueType: 'BOOLEAN', value: true, note: 'ASSOC-1 e2e — store orders' })
      .expect(200);
  });

  it('two associates at one store each see exactly their own orders', async () => {
    const a = await makeAssociate('Associate A', `a-${Date.now()}@scope.test`);
    const b = await makeAssociate('Associate B', `b-${Date.now()}@scope.test`);
    await priceFor(a.storeUserId, '450.00');
    await priceFor(b.storeUserId, '520.00');

    const aOrder = await place(a.auth);
    const bOrder = await place(b.auth, { recipientPhoneE164: '+919876500002' });

    // Each lists exactly one — their own.
    for (const [who, own, other] of [
      [a, aOrder, bOrder],
      [b, bOrder, aOrder],
    ] as const) {
      const list = await request(h.baseUrl).get('/store/orders').set(who.auth).expect(200);
      const ids = (list.body as { items: Array<{ id: string }>; total: number }).items.map(
        (i) => i.id,
      );
      expect(ids).toEqual([own]);
      expect((list.body as { total: number }).total).toBe(1);

      // ...and the other's is a 404 BY ID, not a 403: the scope is in the
      // query, so a colleague's order is indistinguishable from one that
      // does not exist.
      const miss = await request(h.baseUrl).get(`/store/orders/${other}`).set(who.auth);
      expect(miss.status).toBe(404);
      expect(miss.body.code).toBe('ORDER_NOT_FOUND');
      // Every other per-order read is narrowed the same way.
      await request(h.baseUrl).get(`/store/orders/${other}/events`).set(who.auth).expect(404);
      await request(h.baseUrl).get(`/store/orders/${other}/requests`).set(who.auth).expect(404);
    }

    // The ALL-scope member — the owner — sees both. This is the half that
    // says the narrowing is a NARROWING and not a store-wide change.
    const all = await request(h.baseUrl).get('/store/orders').set(ownerAuth).expect(200);
    const allIds = (all.body as { items: Array<{ id: string }> }).items.map((i) => i.id).sort();
    expect(allIds).toEqual([aOrder, bOrder].sort());
    await request(h.baseUrl).get(`/store/orders/${aOrder}`).set(ownerAuth).expect(200);
    await request(h.baseUrl).get(`/store/orders/${bOrder}`).set(ownerAuth).expect(200);
  });

  it('an associate cannot act on a colleague’s order either', async () => {
    // Reading somebody else's parcel is a privacy problem; turning it
    // round is a physical one that costs the seller money, so every
    // per-order ACT carries the same filter.
    const a = await makeAssociate('Associate A', `a2-${Date.now()}@scope.test`);
    const b = await makeAssociate('Associate B', `b2-${Date.now()}@scope.test`);
    await priceFor(a.storeUserId, '450.00');
    await priceFor(b.storeUserId, '450.00');
    const bOrder = await place(b.auth, { recipientPhoneE164: '+919876500003' });

    await request(h.baseUrl)
      .post(`/store/orders/${bOrder}/cancel`)
      .set(a.auth)
      .send({})
      .expect(404);
    await request(h.baseUrl)
      .patch(`/store/orders/${bOrder}/recipient`)
      .set(a.auth)
      .send({ recipientName: 'Someone Else' })
      .expect(404);
    await request(h.baseUrl).get(`/store/orders/${bOrder}/actions`).set(a.auth).expect(404);
    await request(h.baseUrl)
      .post('/store/issues')
      .set(a.auth)
      .send({ orderId: bOrder, subject: 'Not mine to chase' })
      .expect(404);
  });

  it('the store’s cost is absent from an associate’s order, and present for the owner', async () => {
    const a = await makeAssociate('Associate A', `a3-${Date.now()}@scope.test`);
    await priceFor(a.storeUserId, '450.00');
    const id = await place(a.auth);

    const mine = await request(h.baseUrl).get(`/store/orders/${id}`).set(a.auth).expect(200);
    const asAssociate = mine.body as {
      totals: { retailInr: string; cost: { visible: boolean } };
      lines: Array<Record<string, unknown> & { cost: { visible: boolean } }>;
    };
    // The whole cost block is withheld, and NOT as a null field: the
    // union's `visible: false` arm is what makes a future cost field
    // unreachable here by construction.
    expect(asAssociate.totals.cost.visible).toBe(false);
    expect(asAssociate.totals.cost).not.toHaveProperty('transferInr');
    expect(asAssociate.lines).toHaveLength(1);
    expect(asAssociate.lines[0]!.cost.visible).toBe(false);
    expect(asAssociate.lines[0]!.cost).not.toHaveProperty('transferPriceInr');
    expect(asAssociate.lines[0]!.cost).not.toHaveProperty('minRetailInr');
    expect(asAssociate.lines[0]!.cost).not.toHaveProperty('maxRetailInr');
    // What they DO need is still there: their own selling price and what
    // the customer owes.
    expect(asAssociate.lines[0]!.retailUnitInr).toBe('450.00');
    expect(asAssociate.totals.retailInr).toBe('450.00');

    // The order's money plan is refused outright — narrowing it would
    // still show them the store's margin on their own sale.
    const money = await request(h.baseUrl).get(`/store/orders/${id}/money`).set(a.auth);
    expect(money.status).toBe(403);
    expect(money.body.code).toBe('STORE_MONEY_NOT_FOR_ASSOCIATE');

    // The owner sees all of it, byte-for-byte as before.
    const theirs = await request(h.baseUrl).get(`/store/orders/${id}`).set(ownerAuth).expect(200);
    const asOwner = theirs.body as {
      totals: { cost: { visible: boolean; transferInr: string } };
      lines: Array<{ cost: { visible: boolean; transferPriceInr: string } }>;
    };
    expect(asOwner.totals.cost).toEqual({ visible: true, transferInr: '300.00' });
    expect(asOwner.lines[0]!.cost.transferPriceInr).toBe('300.00');
    await request(h.baseUrl).get(`/store/orders/${id}/money`).set(ownerAuth).expect(200);
  });

  it('an associate sells at THEIR price, and may not change it', async () => {
    const a = await makeAssociate('Associate A', `a4-${Date.now()}@scope.test`);

    // Unpriced is refused by name — never the store's suggested retail.
    const unpriced = await request(h.baseUrl).post('/store/orders').set(a.auth).send(order());
    expect(unpriced.status).toBe(409);
    expect(unpriced.body.code).toBe('ASSOCIATE_PRICE_NOT_SET');

    await priceFor(a.storeUserId, '450.00');
    const id = await place(a.auth);
    const placed = await request(h.baseUrl).get(`/store/orders/${id}`).set(a.auth).expect(200);
    expect(
      (placed.body as { lines: Array<{ retailUnitInr: string }> }).lines[0]!.retailUnitInr,
    ).toBe('450.00');

    // A different figure sent is refused rather than accepted.
    const wrong = await request(h.baseUrl)
      .post('/store/orders')
      .set(a.auth)
      .send(order({ items: [{ variantId, quantity: 1, retailUnitPriceInr: 520 }] }));
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('ASSOCIATE_PRICE_FIXED');

    // A price the SELLER's range no longer admits stops them selling, and
    // says whose problem it is. The seller moves the floor above it.
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeId}/catalogue/${variantId}`)
      .set(sellerAuth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0, minRetailInr: '500.00' })
      .expect(200);
    const outOfRange = await request(h.baseUrl).post('/store/orders').set(a.auth).send(order());
    expect(outOfRange.status).toBe(409);
    expect(outOfRange.body.code).toBe('ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE');
  });

  it('a paused associate places nothing, and keeps everything they placed', async () => {
    const a = await makeAssociate('Associate A', `a5-${Date.now()}@scope.test`);
    await priceFor(a.storeUserId, '450.00');
    const before = await place(a.auth);

    await request(h.baseUrl)
      .patch(`/store/associates/${a.storeUserId}/orders-paused`)
      .set(ownerAuth)
      .send({ paused: true })
      .expect(200);

    // Refused at the create boundary, by name, with nothing written.
    const refused = await request(h.baseUrl).post('/store/orders').set(a.auth).send(order());
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ASSOCIATE_ORDERS_PAUSED');

    // ...and the CSV path refuses at the Import click, not row by row.
    const csv = await request(h.baseUrl)
      .post('/store/order-imports/process')
      .set(a.auth)
      .send({
        spacesKey: `sellers/${sellerId}/stores/${storeId}/order-imports/x.csv`,
        fileName: 'x.csv',
      });
    expect(csv.status).toBe(403);
    expect(csv.body.code).toBe('ASSOCIATE_ORDERS_PAUSED');

    // Everything already placed carries on: they still read it, still see
    // its timeline, and can still call it off. A pause is not a removal.
    await request(h.baseUrl).get(`/store/orders/${before}`).set(a.auth).expect(200);
    await request(h.baseUrl).get(`/store/orders/${before}/events`).set(a.auth).expect(200);
    await request(h.baseUrl)
      .post(`/store/orders/${before}/cancel`)
      .set(a.auth)
      .send({})
      .expect(200);

    // Switching it back on takes effect on their next call, not when
    // their token expires.
    await request(h.baseUrl)
      .patch(`/store/associates/${a.storeUserId}/orders-paused`)
      .set(ownerAuth)
      .send({ paused: false })
      .expect(200);
    await request(h.baseUrl)
      .post('/store/orders')
      .set(a.auth)
      .send(order({ recipientPhoneE164: '+919876500004' }))
      .expect(201);
  });

  it('the customer list is narrowed the same way — over the orders, not the identity', async () => {
    const a = await makeAssociate('Associate A', `a6-${Date.now()}@scope.test`);
    const b = await makeAssociate('Associate B', `b6-${Date.now()}@scope.test`);
    await priceFor(a.storeUserId, '450.00');
    await priceFor(b.storeUserId, '450.00');
    await place(a.auth, { recipientPhoneE164: '+919876500011', recipientName: 'A Customer' });
    await place(b.auth, { recipientPhoneE164: '+919876500022', recipientName: 'B Customer' });

    const aList = await request(h.baseUrl).get('/store/customers').set(a.auth).expect(200);
    const aPhones = (aList.body as { items: Array<{ phoneE164: string }> }).items.map(
      (c) => c.phoneE164,
    );
    expect(aPhones).toEqual(['+919876500011']);

    const bList = await request(h.baseUrl).get('/store/customers').set(b.auth).expect(200);
    expect(
      (bList.body as { items: Array<{ phoneE164: string }> }).items.map((c) => c.phoneE164),
    ).toEqual(['+919876500022']);

    // The owner sees both.
    const ownerList = await request(h.baseUrl).get('/store/customers').set(ownerAuth).expect(200);
    expect((ownerList.body as { total: number }).total).toBe(2);

    // A colleague's customer by id is a 404, and so is editing them.
    const bCustomerId = (bList.body as { items: Array<{ id: string }> }).items[0]!.id;
    await request(h.baseUrl).get(`/store/customers/${bCustomerId}`).set(a.auth).expect(404);
    await request(h.baseUrl)
      .patch(`/store/customers/${bCustomerId}`)
      .set(a.auth)
      .send({ name: 'Renamed by somebody else' })
      .expect(404);
  });

  it('TWO associates selling to ONE phone share the customer row, and both see it', async () => {
    /*
      The trap this closes. Customer identity is per OWNER (ORD-7 as RS-5
      generalised it), so the store has ONE row for a phone however many
      of its people sold to it — there is no second row to hand one of
      them. A scope written over the customer rather than over the ORDERS
      would therefore hide that person from one of the two associates who
      genuinely sold to them, which is wrong in the other direction.
    */
    const a = await makeAssociate('Associate A', `a7-${Date.now()}@scope.test`);
    const b = await makeAssociate('Associate B', `b7-${Date.now()}@scope.test`);
    await priceFor(a.storeUserId, '450.00');
    await priceFor(b.storeUserId, '450.00');
    const shared = '+919876500033';
    await place(a.auth, { recipientPhoneE164: shared, recipientName: 'Shared Customer' });
    await place(b.auth, { recipientPhoneE164: shared, recipientName: 'Shared Customer' });

    for (const who of [a, b]) {
      const list = await request(h.baseUrl).get('/store/customers').set(who.auth).expect(200);
      const items = (list.body as { items: Array<{ id: string; phoneE164: string }> }).items;
      expect(items.map((c) => c.phoneE164)).toEqual([shared]);
      await request(h.baseUrl).get(`/store/customers/${items[0]!.id}`).set(who.auth).expect(200);
    }
    // One row, not two — the identity did not fork.
    const ownerList = await request(h.baseUrl).get('/store/customers').set(ownerAuth).expect(200);
    expect((ownerList.body as { total: number }).total).toBe(1);
  });

  it('the CSV imports an associate sees are their own', async () => {
    // The error report is the rejected rows of somebody's upload —
    // customers' names, phones and addresses included.
    const a = await makeAssociate('Associate A', `a8-${Date.now()}@scope.test`);
    const b = await makeAssociate('Associate B', `b8-${Date.now()}@scope.test`);
    const bUpload = await h.prisma.bulkOrderUpload.create({
      data: {
        sellerId,
        resellerStoreId: storeId,
        uploadedByStoreUserId: b.storeUserId,
        fileName: 'b.csv',
        spacesKey: `sellers/${sellerId}/stores/${storeId}/order-imports/b.csv`,
        fileSizeBytes: 10,
        rowCount: 1,
        status: 'PENDING',
      },
      select: { id: true },
    });

    const aList = await request(h.baseUrl).get('/store/order-imports').set(a.auth).expect(200);
    expect((aList.body as { total: number }).total).toBe(0);
    await request(h.baseUrl).get(`/store/order-imports/${bUpload.id}`).set(a.auth).expect(404);
    await request(h.baseUrl)
      .get(`/store/order-imports/${bUpload.id}/error-report`)
      .set(a.auth)
      .expect(404);

    // Its owner reads it, and so does the store's owner.
    await request(h.baseUrl).get(`/store/order-imports/${bUpload.id}`).set(b.auth).expect(200);
    await request(h.baseUrl).get(`/store/order-imports/${bUpload.id}`).set(ownerAuth).expect(200);
  });

  it('a ticket an associate raises carries no settlement figures, and a colleague’s is a 404', async () => {
    const a = await makeAssociate('Associate A', `a9-${Date.now()}@scope.test`);
    const b = await makeAssociate('Associate B', `b9-${Date.now()}@scope.test`);
    await priceFor(a.storeUserId, '450.00');
    await priceFor(b.storeUserId, '450.00');
    const aOrder = await place(a.auth);
    const bOrder = await place(b.auth, { recipientPhoneE164: '+919876500044' });

    const raised = await request(h.baseUrl)
      .post('/store/tickets')
      .set(a.auth)
      .send({ orderId: aOrder, subject: 'The parcel is late' })
      .expect(201);
    const ticketId = (raised.body as { id: string }).id;
    // The settlement block is a withheld union, not a null field.
    expect((raised.body as { figures: { visible: boolean } }).figures.visible).toBe(false);
    expect(raised.body.figures).not.toHaveProperty('snapshot');

    const mine = await request(h.baseUrl).get(`/store/tickets/${ticketId}`).set(a.auth).expect(200);
    expect((mine.body as { figures: { visible: boolean } }).figures.visible).toBe(false);

    // A ticket on a colleague's order is not theirs to read or reply to.
    const bTicket = await request(h.baseUrl)
      .post('/store/tickets')
      .set(b.auth)
      .send({ orderId: bOrder, subject: 'Mine, not yours' })
      .expect(201);
    const bTicketId = (bTicket.body as { id: string }).id;
    await request(h.baseUrl).get(`/store/tickets/${bTicketId}`).set(a.auth).expect(404);
    await request(h.baseUrl).get(`/store/tickets/${bTicketId}/events`).set(a.auth).expect(404);
    await request(h.baseUrl)
      .post(`/store/tickets/${bTicketId}/notes`)
      .set(a.auth)
      .send({ note: 'Not my ticket' })
      .expect(404);
    const aList = await request(h.baseUrl).get('/store/tickets').set(a.auth).expect(200);
    expect((aList.body as { items: Array<{ id: string }> }).items.map((t) => t.id)).toEqual([
      ticketId,
    ]);

    // The owner reads both, with the figures visible.
    const ownerView = await request(h.baseUrl)
      .get(`/store/tickets/${bTicketId}`)
      .set(ownerAuth)
      .expect(200);
    expect((ownerView.body as { figures: { visible: boolean } }).figures.visible).toBe(true);
  });
});
