import request from 'supertest';
import { OrderStatus, WalletEntryDirection } from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { OrderChargesAccrualService } from '../../src/modules/seller-wallet-accrual/services/order-charges-accrual.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Bulk cancel is a LOOP over the single cancel — nothing more (owner,
 * 2026-11-19, Phase B). These tests hold it to that against a real
 * database: the wallet rows, the stock holds and the refusals a bulk
 * cancel produces are exactly the ones the single cancel produces, a
 * double-click runs nothing twice, and another seller's order is never
 * touched or revealed.
 */
describe('Bulk order cancel (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerAuth: { Authorization: string };
  let sellerId: string;
  let warehouseId: string;
  let binId: string;
  let variantId: string;

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

    const email = `cancel-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Cancel Brand',
        contactPersonName: 'Cancel Owner',
        phone: '+8801712345691',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };
    sellerId = reg.body.seller.id as string;

    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    warehouseId = (whs.body as Array<{ id: string; code: string }>).find(
      (w) => w.code === 'CCU-01',
    )!.id;
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

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Widget', externalRef: 'W-1' })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'W-1-STD' })
      .expect(201);
    variantId = variant.body.id as string;
  });

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

  let phoneSeq = 0;
  async function placeOrder(): Promise<string> {
    const res = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Cancel Customer',
        // A distinct customer per order: four orders in one millisecond
        // would otherwise share a phone and be refused as suspected duplicates.
        recipientPhoneE164: `+91987${String(Date.now() % 100000).padStart(5, '0')}${String((phoneSeq += 1) % 100).padStart(2, '0')}`,
        recipientAddressLine1: '12 Test Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientCity: 'New Delhi',
        recipientStateProvince: 'Delhi',
        recipientPostalCode: '110001',
        paymentMode: 'COD',
        codAmountInr: 500,
        items: [{ variantId, quantity: 2 }],
      })
      .expect(201);
    const id = res.body.id as string;
    // A manual order is created as a DRAFT; submitting is what puts it
    // in front of a call agent, which is where the interesting cancel
    // cases start.
    await request(h.baseUrl).post(`/seller/orders/${id}/submit`).set(sellerAuth).expect(200);
    return id;
  }

  function writeSvc(): OrderWriteService {
    return h.app.get(OrderWriteService);
  }

  /** Reserved qty + how much stock is physically on hand. */
  async function stock(): Promise<{ onHand: number; reserved: number; activeResv: number }> {
    const levels = await h.prisma.stockLevel.findMany({ where: { variantId } });
    const active = await h.prisma.stockReservation.count({
      where: { variantId, status: 'ACTIVE' },
    });
    return {
      onHand: levels.reduce((n, l) => n + l.qtyOnHand, 0),
      reserved: levels.reduce((n, l) => n + l.qtyReserved, 0),
      activeResv: active,
    };
  }

  async function walletEntries(orderId: string) {
    return h.prisma.sellerWalletEntry.findMany({
      where: { linkedOrderId: orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Debit the delivery fee (as AT_AWB would) and confirm — the money case. */
  async function chargedAndConfirmed(): Promise<{ orderId: string; charged: string }> {
    const orderId = await placeOrder();
    const accrual = h.app.get(OrderChargesAccrualService);
    await h.prisma.$transaction(async (tx) => {
      await accrual.debitIfNeeded(tx, orderId, sellerId);
    });
    const debit = (await walletEntries(orderId)).find(
      (e) => e.direction === WalletEntryDirection.ORDER_CHARGES,
    );
    expect(debit).toBeDefined();
    await writeSvc().transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: 'SYSTEM', id: null } as never,
      reason: 'test confirm',
    });
    return { orderId, charged: debit!.amount.toString() };
  }

  function summary(entries: Awaited<ReturnType<typeof walletEntries>>): string[] {
    return entries.map((e) => `${e.direction}:${e.amount.toString()}`).sort();
  }

  it('bulk cancel writes exactly the wallet rows and stock releases single cancels write', async () => {
    await receiveStock(20);
    const control = await chargedAndConfirmed();
    const bulk = [
      await chargedAndConfirmed(),
      await chargedAndConfirmed(),
      await chargedAndConfirmed(),
    ];

    // The control order: cancelled the ordinary way.
    await request(h.baseUrl)
      .post(`/seller/orders/${control.orderId}/cancel`)
      .set(sellerAuth)
      .send({})
      .expect(200);
    const controlRows = summary(await walletEntries(control.orderId));

    const res = await request(h.baseUrl)
      .post('/seller/bulk/orders/cancel')
      .set(sellerAuth)
      .send({ orderIds: bulk.map((b) => b.orderId), idempotencyKey: `k-${Date.now()}-a` })
      .expect(200);
    expect(res.body).toMatchObject({ done: 3, skipped: 0, failed: 0, replayed: false });

    for (const b of bulk) {
      const row = await h.prisma.order.findUniqueOrThrow({ where: { id: b.orderId } });
      expect(row.status).toBe(OrderStatus.CANCELLED);
      const entries = await walletEntries(b.orderId);
      // Same shape as the single cancel: one debit, one refund of exactly it.
      expect(summary(entries)).toEqual(
        controlRows.map((r) => r.replace(/:.*$/, `:${b.charged}`)).sort(),
      );
      const refunds = entries.filter(
        (e) => e.direction === WalletEntryDirection.ORDER_CHARGES_REFUND,
      );
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.amount.toString()).toBe(b.charged);
    }
    // Every hold released, as four single cancels would.
    expect((await stock()).activeResv).toBe(0);
  });

  it('a double-click runs nothing twice: the replay returns the first result', async () => {
    await receiveStock(10);
    const a = await chargedAndConfirmed();
    const key = `k-${Date.now()}-b`;
    const first = await request(h.baseUrl)
      .post('/seller/bulk/orders/cancel')
      .set(sellerAuth)
      .send({ orderIds: [a.orderId], idempotencyKey: key })
      .expect(200);
    const second = await request(h.baseUrl)
      .post('/seller/bulk/orders/cancel')
      .set(sellerAuth)
      .send({ orderIds: [a.orderId], idempotencyKey: key })
      .expect(200);
    expect(first.body.replayed).toBe(false);
    expect(second.body).toMatchObject({ replayed: true, done: 1 });
    const refunds = (await walletEntries(a.orderId)).filter(
      (e) => e.direction === WalletEntryDirection.ORDER_CHARGES_REFUND,
    );
    expect(refunds).toHaveLength(1);
  });

  it("refusals are per order: a packed parcel and another seller's order are skipped, the rest done", async () => {
    await receiveStock(10);
    const ok = await placeOrder();
    const packed = await placeOrder();
    const ow = writeSvc();
    const sys = { type: 'SYSTEM', id: null } as never;
    for (const to of [
      OrderStatus.CONFIRMED,
      OrderStatus.PENDING_PICK,
      OrderStatus.PICKED,
      OrderStatus.PACKED,
    ]) {
      await ow.transitionStatus({ orderId: packed, to, actor: sys, reason: 't' });
    }

    const otherEmail = `bulk-other-${Date.now()}@brand.com`;
    const inv = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email: otherEmail })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: inv.body.token,
        companyName: 'Other Brand',
        contactPersonName: 'Other Owner',
        phone: '+8801712345693',
        password: 'SellerPass-1234',
      })
      .expect(201);
    const otherAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    // The OTHER seller tries to bulk-cancel this seller's order.
    const foreign = await request(h.baseUrl)
      .post('/seller/bulk/orders/cancel')
      .set(otherAuth)
      .send({ orderIds: [ok], idempotencyKey: `k-${Date.now()}-c` })
      .expect(200);
    expect(foreign.body).toMatchObject({ done: 0, skipped: 1 });
    expect(foreign.body.results[0].code).toBe('ORDER_NOT_FOUND');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: ok } })).status).toBe(
      OrderStatus.PENDING_CONFIRMATION,
    );

    const res = await request(h.baseUrl)
      .post('/seller/bulk/orders/cancel')
      .set(sellerAuth)
      .send({ orderIds: [ok, packed], idempotencyKey: `k-${Date.now()}-d` })
      .expect(200);
    expect(res.body).toMatchObject({ done: 1, skipped: 1, failed: 0 });
    const byId = new Map(
      (res.body.results as Array<{ orderId: string; outcome: string; code?: string }>).map((r) => [
        r.orderId,
        r,
      ]),
    );
    expect(byId.get(ok)?.outcome).toBe('DONE');
    expect(byId.get(packed)).toMatchObject({ outcome: 'SKIPPED', code: 'NOT_CANCELLABLE' });
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: packed } })).status).toBe(
      OrderStatus.PACKED,
    );
  });

  it('refuses more than 200 at once', async () => {
    const ids = Array.from({ length: 201 }, () => '01900000-0000-7000-8000-000000000000');
    await request(h.baseUrl)
      .post('/seller/bulk/orders/cancel')
      .set(sellerAuth)
      .send({ orderIds: ids, idempotencyKey: `k-${Date.now()}-e` })
      .expect(400);
  });
});
