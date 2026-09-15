import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { ActorType, OrderStatus, ProductStatus, SellerStatus, StaffRole } from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * RS-5 — reseller store ORDERS, against a real database.
 *
 * The unit specs pin the refusal order, the arithmetic and the mask; this
 * pins what only Postgres can show: the snapshot columns and CHECKs land
 * as written, the confirm-time set-aside guard (a lock inside the
 * reservation's own transaction) routes to OUT_OF_STOCK for a store AND
 * for the seller's own order, and the close race is closed in both
 * directions — a row lock a mocked Prisma does not have.
 */
describe('reseller store orders (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let sellerId: string;
  let sellerAuth: { Authorization: string };
  let variantId: string;
  let binId: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  function terms(): Record<string, unknown> {
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
      basedOnVersion: 0,
    };
  }

  /** A store with its owner signed in, terms published and accepted. */
  async function makeStore(label: string): Promise<{
    storeId: string;
    auth: { Authorization: string };
    termsVersionId: string;
  }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(sellerAuth)
      .send({
        name: `${label} ${Math.random().toString(36).slice(2, 8)}`,
        displayName: `${label} Display`,
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
    const auth = {
      Authorization: `Bearer ${(accepted.body as { accessToken: string }).accessToken}`,
    };
    const published = await request(h.baseUrl)
      .post(`/seller/reseller-stores/${storeId}/terms`)
      .set(sellerAuth)
      .send(terms())
      .expect(201);
    const termsVersionId = (published.body as { current: { id: string } }).current.id;
    await request(h.baseUrl)
      .post(`/store/terms/${termsVersionId}/accept`)
      .set(auth)
      .send({})
      .expect(200);
    return { storeId, auth, termsVersionId };
  }

  async function sellVariant(
    storeId: string,
    stock: { stockMode: 'SHARED' | 'SET_ASIDE'; setAsideQty?: number },
  ): Promise<void> {
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeId}/catalogue/${variantId}`)
      .set(sellerAuth)
      .send({
        enabled: true,
        stockMode: stock.stockMode,
        ...(stock.setAsideQty === undefined ? {} : { setAsideQty: stock.setAsideQty }),
        hiddenPercent: 0,
      })
      .expect(200);
  }

  async function enableOrders(on: boolean): Promise<void> {
    await request(h.baseUrl)
      .patch(`/admin/sellers/${sellerId}/settings/reseller.orders_enabled`)
      .set(staffAuth)
      .send({ valueType: 'BOOLEAN', value: on, note: 'RS-5 e2e — store orders for this seller' })
      .expect(200);
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

  function storeOrder(qty: number, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      recipientName: 'Asha Verma',
      recipientPhoneE164: '+919876500001',
      recipientEmail: 'asha@example.com',
      recipientAddressLine1: '12 MG Road',
      recipientAddressLine2: 'Near City Hospital',
      recipientPostalCode: '560001',
      paymentMode: 'COD',
      acknowledgeDuplicate: true,
      items: [{ variantId, quantity: qty, retailUnitPriceInr: 499 }],
      ...over,
    };
  }

  async function channelOrder(qty: number): Promise<string> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Own Customer',
        recipientPhoneE164: '+919876500099',
        acknowledgeDuplicate: true,
        recipientAddressLine1: '1 Seller Street',
        recipientAddressLine2: 'Opposite the park',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        codAmountInr: 999,
        items: [{ variantId, quantity: qty }],
      })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await request(h.baseUrl).post(`/seller/orders/${id}/submit`).set(sellerAuth).expect(200);
    return id;
  }

  async function confirm(orderId: string): Promise<OrderStatus> {
    const res = await h.app.get(OrderWriteService).transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    return res.status;
  }

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    staffId = staff.id;
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const email = `rs5-${Date.now()}-${Math.random().toString(36).slice(2)}@orders.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'RS5 Brand',
        contactPersonName: 'RS5 Owner',
        phone: '+8801712345601',
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
      .send({ email, password: 'SellerPass-1234' })
      .expect(200);
    sellerAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    const warehouseId = (whs.body as Array<{ id: string; code: string }>).find(
      (w) => w.code === 'CCU-01',
    )?.id;
    expect(warehouseId).toBeDefined();
    const zone = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/zones`)
      .set(staffAuth)
      .send({ code: 'R', name: 'Zone R' })
      .expect(201);
    const bin = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId: zone.body.id, aisle: 'R', rack: '1', shelf: '1', type: 'STORAGE' })
      .expect(201);
    binId = bin.body.id as string;

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Kurta', externalRef: 'K-1' })
      .expect(201);
    // A resellable variant needs an ACTIVE product (as tenant-isolation's RS-3 cases).
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
  });

  it('refuses in order, then places an order that carries the store’s terms as placed', async () => {
    await receiveStock(10);
    const store = await makeStore('shop');
    await sellVariant(store.storeId, { stockMode: 'SET_ASIDE', setAsideQty: 4 });

    // The master switch is OFF by default — nothing else is even asked.
    const off = await request(h.baseUrl).post('/store/orders').set(store.auth).send(storeOrder(1));
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('RESELLER_ORDERS_DISABLED');

    await enableOrders(true);
    const low = await request(h.baseUrl)
      .post('/store/orders')
      .set(store.auth)
      .send(storeOrder(1, { items: [{ variantId, quantity: 1, retailUnitPriceInr: 399 }] }));
    expect(low.status).toBe(400);
    expect(low.body.code).toBe('RETAIL_OUT_OF_RANGE');
    const prepaid = await request(h.baseUrl)
      .post('/store/orders')
      .set(store.auth)
      .send(storeOrder(1, { paymentMode: 'PREPAID' }));
    // RS-6 phase 3c: prepaid is ON — paid from the store's wallet, which is empty.
    expect(prepaid.status).toBe(409);
    expect(prepaid.body.code).toBe('STORE_BALANCE_INSUFFICIENT');
    // Four set aside — five is more than the store is shown.
    const tooMany = await request(h.baseUrl)
      .post('/store/orders')
      .set(store.auth)
      .send(storeOrder(5));
    expect(tooMany.body.code).toBe('RESELLER_QTY_EXCEEDS_VISIBLE');
    expect(await h.prisma.order.count({ where: { storeId: store.storeId } })).toBe(0);

    const placed = await request(h.baseUrl)
      .post('/store/orders')
      .set(store.auth)
      .send(storeOrder(2))
      .expect(201);
    const orderId = (placed.body as { id: string }).id;
    const row = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, customer: true },
    });
    expect(row.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(row.storeKind).toBe('RESELLER');
    expect(row.storeNameSnapshot).toBe('shop Display');
    expect(row.resellerTermsVersionId).toBe(store.termsVersionId);
    expect(row.resellerDeliveryFeeStorePercent?.toFixed(2)).toBe('80.00');
    expect(row.resellerStoreCreditTrigger).toBe('ON_PAYOUT');
    expect(row.codAmountInr?.toFixed(2)).toBe('998.00');
    expect(row.items[0]?.resellerTransferPriceInr?.toFixed(2)).toBe('300.00');
    expect(row.items[0]?.resellerRetailUnitInr?.toFixed(2)).toBe('499.00');
    expect(row.items[0]?.unitPriceInr?.toFixed(2)).toBe('499.00');
    expect(row.items[0]?.resellerStockMode).toBe('SET_ASIDE');
    // The customer is the STORE's.
    expect(row.customer?.resellerStoreId).toBe(store.storeId);

    // The seller sees the order — and not who it is going to.
    const seen = await request(h.baseUrl)
      .get(`/seller/orders/${orderId}`)
      .set(sellerAuth)
      .expect(200);
    expect(seen.body.recipientMasked).toBe(true);
    expect(JSON.stringify(seen.body)).not.toContain('Asha');
    expect(JSON.stringify(seen.body)).not.toContain('9876500001');
    const bySearch = await request(h.baseUrl)
      .get('/seller/orders?search=9876500001')
      .set(sellerAuth)
      .expect(200);
    expect(bySearch.body.total).toBe(0);
    // …and cannot edit it.
    const edit = await request(h.baseUrl)
      .patch(`/seller/orders/${orderId}`)
      .set(sellerAuth)
      .send({ recipientName: 'Changed' });
    expect(edit.body.code).toBe('RESELLER_ORDER_NOT_EDITABLE');

    // A snapshot is immutable: a later price change does not re-price it.
    await request(h.baseUrl)
      .put(`/seller/reseller-price-list/${variantId}`)
      .set(sellerAuth)
      .send({ transferPriceInr: '350.00', minRetailInr: '400.00', maxRetailInr: '600.00' })
      .expect(200);
    const again = await h.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    expect(again.resellerTransferPriceInr?.toFixed(2)).toBe('300.00');

    // The store sees it in full.
    const own = await request(h.baseUrl)
      .get(`/store/orders/${orderId}`)
      .set(store.auth)
      .expect(200);
    expect(own.body.recipient.name).toBe('Asha Verma');
    expect(own.body.totals).toEqual({ retailInr: '998.00', transferInr: '600.00' });
  });

  it('a PAUSED store places nothing; its in-flight order carries on', async () => {
    await receiveStock(10);
    const store = await makeStore('paused');
    await sellVariant(store.storeId, { stockMode: 'SHARED' });
    await enableOrders(true);
    await request(h.baseUrl).post('/store/orders').set(store.auth).send(storeOrder(1)).expect(201);
    await request(h.baseUrl)
      .post(`/seller/reseller-stores/${store.storeId}/pause`)
      .set(sellerAuth)
      .send({ reason: 'Stock check this week' })
      .expect(200);
    const res = await request(h.baseUrl).post('/store/orders').set(store.auth).send(storeOrder(1));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RESELLER_STORE_PAUSED');
  });

  it('confirmation keeps every order off a store’s unused set-aside — the seller’s own included', async () => {
    await receiveStock(10);
    const setAside = await makeStore('holder');
    const shared = await makeStore('sharer');
    await sellVariant(setAside.storeId, { stockMode: 'SET_ASIDE', setAsideQty: 4 });
    await sellVariant(shared.storeId, { stockMode: 'SHARED' });
    await enableOrders(true);

    // 10 on hand, 4 set aside: the seller's own order may take 6, not 7.
    const seven = await channelOrder(7);
    expect(await confirm(seven)).toBe(OrderStatus.OUT_OF_STOCK);
    const six = await channelOrder(6);
    expect(await confirm(six)).toBe(OrderStatus.CONFIRMED);

    // The sharing store is now shown nothing (4 left, all of them set aside).
    const blocked = await request(h.baseUrl)
      .post('/store/orders')
      .set(shared.auth)
      .send(storeOrder(1));
    expect(blocked.body.code).toBe('RESELLER_QTY_EXCEEDS_VISIBLE');

    // The set-aside store takes its four.
    const held = await request(h.baseUrl)
      .post('/store/orders')
      .set(setAside.auth)
      .send(storeOrder(4))
      .expect(201);
    expect(await confirm((held.body as { id: string }).id)).toBe(OrderStatus.CONFIRMED);
    // Consumed: the catalogue now shows it none.
    const cat = await request(h.baseUrl).get('/store/catalogue').set(setAside.auth).expect(200);
    expect((cat.body as { items: Array<{ availableQty: number }> }).items[0]?.availableQty).toBe(0);
  });

  it('a store order that exceeds what confirmation allows lands OUT_OF_STOCK, never a 500', async () => {
    await receiveStock(5);
    const shared = await makeStore('late');
    await sellVariant(shared.storeId, { stockMode: 'SHARED' });
    await enableOrders(true);
    const placed = await request(h.baseUrl)
      .post('/store/orders')
      .set(shared.auth)
      .send(storeOrder(5))
      .expect(201);
    // Stock is taken by the seller's own order before the call centre gets
    // to the store's (placement reserves nothing — ORD-10).
    const own = await channelOrder(3);
    expect(await confirm(own)).toBe(OrderStatus.CONFIRMED);
    expect(await confirm((placed.body as { id: string }).id)).toBe(OrderStatus.OUT_OF_STOCK);
  });

  describe('the close race (RS-1) — a row lock, both ways', () => {
    function pending<T>(p: Promise<T>): { readonly promise: Promise<T>; settled: () => boolean } {
      let done = false;
      const promise = p.then(
        (v) => {
          done = true;
          return v;
        },
        (e: unknown) => {
          done = true;
          throw e;
        },
      );
      return { promise, settled: () => done };
    }

    it('a close committed first: the order waiting on the store row sees CLOSED and is refused', async () => {
      await receiveStock(10);
      const store = await makeStore('closing');
      await sellVariant(store.storeId, { stockMode: 'SHARED' });
      await enableOrders(true);

      let release: () => void = () => undefined;
      const hold = new Promise<void>((r) => {
        release = r;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((r) => {
        locked = r;
      });
      // A close in flight: the row taken FOR UPDATE and its status moved.
      const closing = h.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "seller_stores" WHERE "id" = ${store.storeId}::uuid FOR UPDATE`;
          await tx.$executeRaw`UPDATE "seller_stores" SET "status" = 'closed' WHERE "id" = ${store.storeId}::uuid`;
          locked();
          await hold;
        },
        { timeout: 30_000 },
      );
      await isLocked;

      const order = pending(
        request(h.baseUrl)
          .post('/store/orders')
          .set(store.auth)
          .send(storeOrder(1))
          .then((r) => r),
      );
      await new Promise((r) => setTimeout(r, 700));
      expect(order.settled()).toBe(false); // waiting on the row lock
      release();
      await closing;
      const res = await order.promise;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('RESELLER_STORE_NOT_ACTIVE');
      expect(await h.prisma.order.count({ where: { storeId: store.storeId } })).toBe(0);
    });

    // Since 2026-09-15 (RS-1, amended) a store is closed only from PAUSED,
    // and a PAUSED store takes no orders — so an order and a CLOSE can no
    // longer race. The race that remains is an order against the PAUSE,
    // and the lock that decides it is the same row lock: the pause waits
    // for an order already being placed, lets it through, and the paused
    // store then cannot close while that order is still in flight.
    it('an order committed first: the pause waiting on the store row lets it through, and the store cannot close while it is in flight', async () => {
      await receiveStock(10);
      const store = await makeStore('racing');
      await sellVariant(store.storeId, { stockMode: 'SHARED' });
      await enableOrders(true);

      let release: () => void = () => undefined;
      const hold = new Promise<void>((r) => {
        release = r;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((r) => {
        locked = r;
      });
      // An order being placed: the store row FOR SHARE, and the order row
      // written in the same transaction — exactly what create does.
      const placing = h.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "status"::text FROM "seller_stores" WHERE "id" = ${store.storeId}::uuid FOR SHARE`;
          await tx.order.create({
            data: {
              sellerId,
              storeId: store.storeId,
              storeKind: 'RESELLER',
              storeNameSnapshot: 'racing Display',
              orderNumber: `SD-2026-98-${Math.floor(Math.random() * 900000 + 100000)}`,
              status: 'PENDING_CONFIRMATION',
              paymentMode: 'COD',
              codAmountInr: '499.00',
              recipientName: 'Race Customer',
              recipientPhoneE164: '+919876500077',
              recipientAddressLine1: '7 Race Road',
              recipientAddressLine2: 'Near the ground',
              recipientCity: '',
              recipientStateProvince: '',
              recipientPostalCode: '560001',
              recipientCountryCode: 'IN',
              declaredValueInr: '0.00',
              resellerTermsVersionId: store.termsVersionId,
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
          });
          locked();
          await hold;
        },
        { timeout: 30_000 },
      );
      await isLocked;

      const pause = pending(
        request(h.baseUrl)
          .post(`/seller/reseller-stores/${store.storeId}/pause`)
          .set(sellerAuth)
          .send({ reason: 'Pausing the store before closing it' })
          .then((r) => r),
      );
      await new Promise((r) => setTimeout(r, 700));
      expect(pause.settled()).toBe(false); // waiting on the row lock
      release();
      await placing;
      const paused = await pause.promise;
      expect(paused.status).toBe(200);
      expect(paused.body.status).toBe('PAUSED');

      // The order got in before the pause, so the store cannot close yet.
      const res = await request(h.baseUrl)
        .post(`/seller/reseller-stores/${store.storeId}/close`)
        .set(sellerAuth)
        .send({ reason: 'Closing the store for good' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STORE_HAS_ORDERS_IN_FLIGHT');
      expect(String(res.body.message)).toContain('SD-2026-98-');
      const after = await h.prisma.sellerStore.findUniqueOrThrow({
        where: { id: store.storeId },
        select: { status: true },
      });
      expect(after.status).toBe('PAUSED');
    });
  });

  it('the CHECKs refuse a half-reseller order and a channel order carrying terms', async () => {
    const store = await makeStore('checks');
    const base = {
      sellerId,
      storeId: store.storeId,
      storeNameSnapshot: 'checks',
      status: 'PENDING_CONFIRMATION' as const,
      paymentMode: 'COD' as const,
      recipientName: 'X',
      recipientPhoneE164: '+919876500055',
      recipientAddressLine1: '1',
      recipientAddressLine2: '2',
      recipientCity: '',
      recipientStateProvince: '',
      recipientPostalCode: '560001',
      recipientCountryCode: 'IN',
      declaredValueInr: '0.00',
    };
    // A reseller order with no snapshot.
    await expect(
      h.prisma.order.create({
        data: { ...base, storeKind: 'RESELLER', orderNumber: `SD-2026-97-${Date.now() % 1000000}` },
      }),
    ).rejects.toThrow();
    // A store of one kind filed as the other — the composite FK.
    await expect(
      h.prisma.order.create({
        data: { ...base, storeKind: 'CHANNEL', orderNumber: `SD-2026-96-${Date.now() % 1000000}` },
      }),
    ).rejects.toThrow();
  });
});
