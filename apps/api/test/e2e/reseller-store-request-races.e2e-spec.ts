import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import {
  ActorType,
  DeliveryActionStatus,
  OrderStatus,
  ProductStatus,
  ResellerStoreActionMode,
  SellerStatus,
  StaffRole,
  StoreAddressChangeStatus,
  StoreOrderRequestStatus,
} from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { StoreRequestExpiryService } from '../../src/modules/store-order-request/services/store-request-expiry.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  settleAwb,
  waitFor,
  type AppHarness,
} from './app-harness';

/**
 * 2026-09-17 — the race guards on a reseller store's asks, against a REAL
 * database.
 *
 * Every guard here is a lock or a guarded `updateMany`, and a mocked
 * Prisma has neither: the unit specs can only show the lock is TAKEN and
 * the predicate is WRITTEN. Only Postgres shows that two callers at once
 * really do end with one row, one decision, one outcome.
 *
 * Each race is `Promise.all` over two real HTTP calls (or a call and the
 * expiry sweep). Nothing sleeps: whichever caller wins, the assertions
 * hold for BOTH orderings — "exactly one" is checked, never "the first".
 * The two approvals use one seller login twice; the claim is keyed on the
 * request, not the person, so two sessions of one user race exactly as
 * two users do.
 */
describe('reseller store request races (e2e)', () => {
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

  const REASON = 'The customer rang and said nobody was home on the first try';

  async function makeStore(
    label: string,
  ): Promise<{ storeId: string; auth: { Authorization: string } }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@store.test`;
    const created = await request(h.baseUrl)
      .post('/seller/reseller-stores')
      .set(sellerAuth)
      .send({
        name: `${label} ${Math.random().toString(36).slice(2, 8)}`,
        displayName: `${label} Display`,
        contactEmail: email,
        contactPhone: '+919800000004',
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
    await request(h.baseUrl)
      .post(`/store/terms/${termsVersionId}/accept`)
      .set(auth)
      .send({})
      .expect(200);
    await request(h.baseUrl)
      .put(`/seller/reseller-stores/${storeId}/catalogue/${variantId}`)
      .set(sellerAuth)
      .send({ enabled: true, stockMode: 'SHARED', hiddenPercent: 0 })
      .expect(200);
    return { storeId, auth };
  }

  /** The seller's policy for the store, written straight to its row (test setup only). */
  async function setPolicy(
    storeId: string,
    over: Partial<Record<'recall' | 'orderChange' | 'cancel', ResellerStoreActionMode>>,
  ): Promise<void> {
    await h.prisma.resellerStoreActionPolicy.upsert({
      where: { storeId },
      create: { storeId, ...over },
      update: over,
    });
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

  /** A store order, PENDING_CONFIRMATION. */
  async function placeOrder(store: { auth: { Authorization: string } }): Promise<string> {
    const placed = await request(h.baseUrl)
      .post('/store/orders')
      .set(store.auth)
      .send({
        recipientName: 'Asha Verma',
        recipientPhoneE164: '+919876500001',
        recipientEmail: 'asha@example.com',
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        acknowledgeDuplicate: true,
        items: [{ variantId, quantity: 1, retailUnitPriceInr: 499 }],
      })
      .expect(201);
    return (placed.body as { id: string }).id;
  }

  /**
   * A store order whose parcel is OUT FOR DELIVERY — the stage a delivery
   * action applies to. Confirmed for real (reservation + shipment), then
   * moved on with a direct status write: the courier journey in between is
   * not what this suite is about.
   */
  async function outForDelivery(store: { auth: { Authorization: string } }): Promise<string> {
    const orderId = await placeOrder(store);
    await h.app.get(OrderWriteService).transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const link = await waitFor(
      () => h.prisma.orderShipment.findFirst({ where: { orderId }, select: { shipmentId: true } }),
      { description: 'shipment provisioned on CONFIRMED' },
    );
    await settleAwb(h.prisma, link.shipmentId);
    await h.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.OUT_FOR_DELIVERY },
    });
    return orderId;
  }

  function statuses(results: ReadonlyArray<{ status: number }>): number[] {
    return results.map((r) => r.status).sort((a, b) => a - b);
  }

  function loser(results: ReadonlyArray<{ status: number; body: unknown }>): { code?: string } {
    return (results.find((r) => r.status === 409)?.body ?? {}) as { code?: string };
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

    const email = `race-${Date.now()}-${Math.random().toString(36).slice(2)}@orders.test`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Race Brand',
        contactPersonName: 'Race Owner',
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
      .send({ code: 'Q', name: 'Zone Q' })
      .expect(201);
    const bin = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId: zone.body.id, aisle: 'Q', rack: '1', shelf: '1', type: 'STORAGE' })
      .expect(201);
    binId = bin.body.id as string;

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Kurta', externalRef: 'K-RACE' })
      .expect(201);
    await h.prisma.product.update({
      where: { id: product.body.id as string },
      data: { status: ProductStatus.ACTIVE },
    });
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'K-RACE-M' })
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
    await request(h.baseUrl)
      .patch(`/admin/sellers/${sellerId}/settings/reseller.orders_enabled`)
      .set(staffAuth)
      .send({ valueType: 'BOOLEAN', value: true, note: 'race e2e — store orders for this seller' })
      .expect(200);
    await receiveStock(10);
  });

  // ── delivery actions ─────────────────────────────────────────────────

  describe('delivery actions', () => {
    it('two store asks at once on one order leave exactly ONE request (held for seller staff)', async () => {
      const store = await makeStore('da-held');
      await setPolicy(store.storeId, { recall: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await outForDelivery(store);

      const ask = () =>
        request(h.baseUrl)
          .post(`/store/orders/${orderId}/actions`)
          .set(store.auth)
          .send({ action: 'RECALL', reason: REASON });
      const results = await Promise.all([ask(), ask()]);

      expect(statuses(results)).toEqual([201, 409]);
      expect(loser(results).code).toBe('DELIVERY_ACTION_ALREADY_OPEN');
      expect(await h.prisma.orderDeliveryActionRequest.count({ where: { orderId } })).toBe(1);
    });

    it('two DIRECT asks at once carry it out exactly once — one request, one ticket', async () => {
      const store = await makeStore('da-direct');
      await setPolicy(store.storeId, { recall: ResellerStoreActionMode.DIRECT });
      const orderId = await outForDelivery(store);

      const ask = () =>
        request(h.baseUrl)
          .post(`/store/orders/${orderId}/actions`)
          .set(store.auth)
          .send({ action: 'RECALL', reason: REASON });
      const results = await Promise.all([ask(), ask()]);

      expect(statuses(results)).toEqual([201, 409]);
      expect(loser(results).code).toBe('DELIVERY_ACTION_ALREADY_OPEN');
      const rows = await h.prisma.orderDeliveryActionRequest.findMany({ where: { orderId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe(DeliveryActionStatus.EXECUTED);
      // Only the row that won was carried out.
      expect(await h.prisma.ticket.count({ where: { orderId } })).toBe(1);
    });

    it('two seller approvals at once: one decides, the other is ALREADY_DECIDED, it runs once', async () => {
      const store = await makeStore('da-approve');
      await setPolicy(store.storeId, { recall: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await outForDelivery(store);
      const asked = await request(h.baseUrl)
        .post(`/store/orders/${orderId}/actions`)
        .set(store.auth)
        .send({ action: 'RECALL', reason: REASON })
        .expect(201);
      const requestId = (asked.body as { request: { id: string } }).request.id;

      const approve = () =>
        request(h.baseUrl)
          .post(`/seller/store-action-requests/${requestId}/approve`)
          .set(sellerAuth)
          .send({ note: 'Yes, ring them' });
      const results = await Promise.all([approve(), approve()]);

      expect(statuses(results)).toEqual([200, 409]);
      expect(loser(results).code).toBe('DELIVERY_ACTION_ALREADY_DECIDED');
      const row = await h.prisma.orderDeliveryActionRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      expect(row.status).toBe(DeliveryActionStatus.EXECUTED);
      expect(await h.prisma.ticket.count({ where: { orderId } })).toBe(1);
    });

    it('an approval racing the expiry sweep ends in exactly one outcome', async () => {
      const store = await makeStore('da-expiry');
      await setPolicy(store.storeId, { recall: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await outForDelivery(store);
      const asked = await request(h.baseUrl)
        .post(`/store/orders/${orderId}/actions`)
        .set(store.auth)
        .send({ action: 'RECALL', reason: REASON })
        .expect(201);
      const requestId = (asked.body as { request: { id: string } }).request.id;
      // Old enough to expire (the default threshold is 72 hours).
      await h.prisma.orderDeliveryActionRequest.update({
        where: { id: requestId },
        data: { createdAt: new Date(Date.now() - 200 * 3_600_000) },
      });

      const [approved] = await Promise.all([
        request(h.baseUrl)
          .post(`/seller/store-action-requests/${requestId}/approve`)
          .set(sellerAuth)
          .send({ note: 'Yes, ring them' }),
        h.app.get(StoreRequestExpiryService).sweep(),
      ]);

      const row = await h.prisma.orderDeliveryActionRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      const tickets = await h.prisma.ticket.count({ where: { orderId } });
      if (approved.status === 200) {
        expect(row.status).toBe(DeliveryActionStatus.EXECUTED);
        expect(row.expiredAt).toBeNull();
        expect(tickets).toBe(1);
      } else {
        expect(approved.status).toBe(409);
        expect(row.status).toBe(DeliveryActionStatus.EXPIRED);
        expect(row.sellerDecidedAt).toBeNull();
        expect(tickets).toBe(0);
      }
    });
  });

  // ── address corrections ──────────────────────────────────────────────

  describe('address corrections', () => {
    const correction = {
      recipientAddressLine1: '14 MG Road, second floor',
      reason: 'The customer rang: the house number on the order is wrong',
    };

    it('two store corrections at once on one order leave exactly ONE request', async () => {
      const store = await makeStore('ac-held');
      await setPolicy(store.storeId, { orderChange: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await placeOrder(store);

      const ask = () =>
        request(h.baseUrl)
          .patch(`/store/orders/${orderId}/recipient`)
          .set(store.auth)
          .send(correction);
      const results = await Promise.all([ask(), ask()]);

      expect(statuses(results)).toEqual([200, 409]);
      expect(loser(results).code).toBe('ADDRESS_CHANGE_ALREADY_OPEN');
      expect(await h.prisma.storeAddressChangeRequest.count({ where: { orderId } })).toBe(1);
    });

    it('two seller approvals at once: one applies it, the other is ALREADY_DECIDED', async () => {
      const store = await makeStore('ac-approve');
      await setPolicy(store.storeId, { orderChange: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await placeOrder(store);
      await request(h.baseUrl)
        .patch(`/store/orders/${orderId}/recipient`)
        .set(store.auth)
        .send(correction)
        .expect(200);
      const held = await h.prisma.storeAddressChangeRequest.findFirstOrThrow({
        where: { orderId },
      });

      const approve = () =>
        request(h.baseUrl)
          .post(`/seller/store-address-changes/${held.id}/approve`)
          .set(sellerAuth)
          .send({ note: 'Agreed' });
      const results = await Promise.all([approve(), approve()]);

      expect(statuses(results)).toEqual([200, 409]);
      expect(loser(results).code).toBe('ADDRESS_CHANGE_ALREADY_DECIDED');
      const row = await h.prisma.storeAddressChangeRequest.findUniqueOrThrow({
        where: { id: held.id },
      });
      expect(row.status).toBe(StoreAddressChangeStatus.APPLIED);
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.recipientAddressLine1).toBe(correction.recipientAddressLine1);
    });

    it('an approval racing the expiry sweep ends in exactly one outcome', async () => {
      const store = await makeStore('ac-expiry');
      await setPolicy(store.storeId, { orderChange: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await placeOrder(store);
      await request(h.baseUrl)
        .patch(`/store/orders/${orderId}/recipient`)
        .set(store.auth)
        .send(correction)
        .expect(200);
      const held = await h.prisma.storeAddressChangeRequest.findFirstOrThrow({
        where: { orderId },
      });
      await h.prisma.storeAddressChangeRequest.update({
        where: { id: held.id },
        data: { createdAt: new Date(Date.now() - 200 * 3_600_000) },
      });

      const [approved] = await Promise.all([
        request(h.baseUrl)
          .post(`/seller/store-address-changes/${held.id}/approve`)
          .set(sellerAuth)
          .send({ note: 'Agreed' }),
        h.app.get(StoreRequestExpiryService).sweep(),
      ]);

      const row = await h.prisma.storeAddressChangeRequest.findUniqueOrThrow({
        where: { id: held.id },
      });
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      if (approved.status === 200) {
        expect(row.status).toBe(StoreAddressChangeStatus.APPLIED);
        expect(order.recipientAddressLine1).toBe(correction.recipientAddressLine1);
      } else {
        expect(approved.status).toBe(409);
        expect(row.status).toBe(StoreAddressChangeStatus.EXPIRED);
        expect(order.recipientAddressLine1).toBe('12 MG Road');
      }
    });
  });

  // ── held cancels (store_order_requests) ──────────────────────────────

  describe('held store order requests', () => {
    const note = 'The customer changed their mind before we called';

    it('two store cancels at once on one order leave exactly ONE request', async () => {
      const store = await makeStore('sr-held');
      await setPolicy(store.storeId, { cancel: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await placeOrder(store);

      const ask = () =>
        request(h.baseUrl).post(`/store/orders/${orderId}/cancel`).set(store.auth).send({ note });
      const results = await Promise.all([ask(), ask()]);

      expect(statuses(results)).toEqual([200, 409]);
      expect(loser(results).code).toBe('STORE_REQUEST_ALREADY_OPEN');
      expect(await h.prisma.storeOrderRequest.count({ where: { orderId } })).toBe(1);
    });

    it('two seller approvals at once: the order is cancelled once, the other is ALREADY_DECIDED', async () => {
      const store = await makeStore('sr-approve');
      await setPolicy(store.storeId, { cancel: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await placeOrder(store);
      await request(h.baseUrl)
        .post(`/store/orders/${orderId}/cancel`)
        .set(store.auth)
        .send({ note })
        .expect(200);
      const held = await h.prisma.storeOrderRequest.findFirstOrThrow({ where: { orderId } });

      const approve = () =>
        request(h.baseUrl)
          .post(`/seller/store-order-requests/${held.id}/approve`)
          .set(sellerAuth)
          .send({ note: 'Fine' });
      const results = await Promise.all([approve(), approve()]);

      expect(statuses(results)).toEqual([200, 409]);
      expect(loser(results).code).toBe('STORE_REQUEST_ALREADY_DECIDED');
      const row = await h.prisma.storeOrderRequest.findUniqueOrThrow({ where: { id: held.id } });
      expect(row.status).toBe(StoreOrderRequestStatus.EXECUTED);
      const cancels = await h.prisma.orderEvent.count({
        where: { orderId, fromStatus: OrderStatus.PENDING_CONFIRMATION, toStatus: { not: null } },
      });
      expect(cancels).toBe(1);
    });

    it('an approval racing the expiry sweep ends in exactly one outcome', async () => {
      const store = await makeStore('sr-expiry');
      await setPolicy(store.storeId, { cancel: ResellerStoreActionMode.ASK_SELLER });
      const orderId = await placeOrder(store);
      await request(h.baseUrl)
        .post(`/store/orders/${orderId}/cancel`)
        .set(store.auth)
        .send({ note })
        .expect(200);
      const held = await h.prisma.storeOrderRequest.findFirstOrThrow({ where: { orderId } });
      await h.prisma.storeOrderRequest.update({
        where: { id: held.id },
        data: { createdAt: new Date(Date.now() - 200 * 3_600_000) },
      });

      const [approved] = await Promise.all([
        request(h.baseUrl)
          .post(`/seller/store-order-requests/${held.id}/approve`)
          .set(sellerAuth)
          .send({ note: 'Fine' }),
        h.app.get(StoreRequestExpiryService).sweep(),
      ]);

      const row = await h.prisma.storeOrderRequest.findUniqueOrThrow({ where: { id: held.id } });
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      if (approved.status === 200) {
        expect(row.status).toBe(StoreOrderRequestStatus.EXECUTED);
        expect(order.status).not.toBe(OrderStatus.PENDING_CONFIRMATION);
      } else {
        expect(approved.status).toBe(409);
        expect(row.status).toBe(StoreOrderRequestStatus.EXPIRED);
        expect(order.status).toBe(OrderStatus.PENDING_CONFIRMATION);
      }
    });
  });
});
