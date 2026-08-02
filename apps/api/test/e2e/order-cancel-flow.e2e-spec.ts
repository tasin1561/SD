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
 * Calling an order off, and getting the money back.
 *
 * Two properties, and they fail in opposite directions if either is
 * missing.
 *
 * The WINDOW: a seller can cancel right up to the moment the parcel is
 * packed, and not after. Before this, the seller's cancel button only
 * worked on orders nobody had touched yet — the instant a call agent
 * confirmed one, the seller had to email us. After PACKED there is a
 * sealed, labelled parcel waiting for a van, and undoing that is
 * warehouse work rather than a decision taken alone from a dashboard.
 *
 * The MONEY: a seller on AT_AWB fee timing is debited at CONFIRMED
 * (CUR-2b generates the waybill there), which is days before anything
 * physically moves. Cancelling after that point used to keep their
 * money silently — nothing failed, no error appeared, and only a seller
 * reconciling their own balance would ever have found it.
 *
 * The conservation assertions are deliberate: this is the third place
 * where "cancel" and "stock" meet (after the RTO finalize bug and the
 * pack-box cancel), and both earlier ones were wrong in a way that only
 * a full-lifecycle test caught.
 */
describe('Order cancellation (e2e)', () => {
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
      (w) => w.code === 'BLR-01',
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

  async function placeOrder(): Promise<string> {
    const res = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Cancel Customer',
        recipientPhoneE164: `+9198765${String(Date.now()).slice(-5)}`,
        recipientAddressLine1: '12 Test Road',
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

  it('cancels a PENDING_CONFIRMATION order and takes it out of the call queue', async () => {
    const orderId = await placeOrder();

    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/cancel`)
      .set(sellerAuth)
      .send({ note: 'Customer changed their mind' })
      .expect(200);

    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(row.status).toBe(OrderStatus.CANCELLED);
    expect(row.cancellationReason).toBe('SELLER_REQUESTED');

    // The gap that routing this through the write boundary closed: the
    // old path wrote the order row directly, so CC-6's dequeue never
    // ran and an agent could still be handed a dead order to phone.
    const open = await h.prisma.callQueueEntry.count({
      where: { orderId, status: 'PENDING' },
    });
    expect(open).toBe(0);
  });

  it('cancels a CONFIRMED order and gives the stock straight back', async () => {
    await receiveStock(10);
    const orderId = await placeOrder();

    await writeSvc().transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: 'SYSTEM', id: null } as never,
      reason: 'test confirm',
    });

    const held = await stock();
    expect(held.activeResv).toBe(1);

    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/cancel`)
      .set(sellerAuth)
      .send({})
      .expect(200);

    const after = await stock();
    // Nothing physically left the building, so on-hand is untouched
    // (CUR-3: qtyOnHand only moves at DISPATCH) and the hold is gone.
    expect(after.onHand).toBe(held.onHand);
    expect(after.activeResv).toBe(0);
  });

  it('refunds a delivery fee already taken, exactly once', async () => {
    await receiveStock(10);
    const orderId = await placeOrder();

    // Stand in for the AT_AWB debit that lands at CONFIRMED. Asserting
    // on the REFUND is the point here; which trigger took the money is
    // the accrual service's own test.
    const charges = await h.prisma.orderCharge.findMany({
      where: { orderId, deletedAt: null },
    });
    expect(charges.length).toBeGreaterThan(0);

    const accrual = h.app.get(OrderChargesAccrualService);
    await h.prisma.$transaction(async (tx) => {
      await accrual.debitIfNeeded(tx, orderId, sellerId);
    });

    const debit = (await walletEntries(orderId)).find(
      (e) => e.direction === WalletEntryDirection.ORDER_CHARGES,
    );
    expect(debit).toBeDefined();
    const charged = debit!.amount.toString();

    await writeSvc().transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: 'SYSTEM', id: null } as never,
      reason: 'test confirm',
    });

    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/cancel`)
      .set(sellerAuth)
      .send({})
      .expect(200);

    const entries = await walletEntries(orderId);
    const refunds = entries.filter(
      (e) => e.direction === WalletEntryDirection.ORDER_CHARGES_REFUND,
    );
    expect(refunds).toHaveLength(1);
    // Exactly what was taken — not a recomputed figure that could drift
    // from it the day a charge type is added.
    expect(refunds[0]!.amount.toString()).toBe(charged);
    expect(refunds[0]!.linkedEntryId).toBe(debit!.id);

    // The round trip nets to zero: the seller is not out of pocket for
    // a parcel that never moved.
    const net = entries.reduce(
      (sum, e) =>
        e.direction === WalletEntryDirection.ORDER_CHARGES_REFUND
          ? sum + Number(e.amount)
          : sum - Number(e.amount),
      0,
    );
    expect(net).toBe(0);
  });

  it('refuses once the parcel is packed, and says so plainly', async () => {
    await receiveStock(10);
    const orderId = await placeOrder();
    const ow = writeSvc();
    const sys = { type: 'SYSTEM', id: null } as never;

    await ow.transitionStatus({ orderId, to: OrderStatus.CONFIRMED, actor: sys, reason: 't' });
    await ow.transitionStatus({ orderId, to: OrderStatus.PENDING_PICK, actor: sys, reason: 't' });
    await ow.transitionStatus({ orderId, to: OrderStatus.PICKED, actor: sys, reason: 't' });

    // Still open at PICKED — the goods are in a tote, not on a van.
    const okAtPicked = await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/cancel`)
      .set(sellerAuth)
      .send({});
    expect(okAtPicked.status).toBe(200);

    // Now take a second order all the way to PACKED and confirm the
    // door has closed.
    const second = await placeOrder();
    await ow.transitionStatus({
      orderId: second,
      to: OrderStatus.CONFIRMED,
      actor: sys,
      reason: 't',
    });
    await ow.transitionStatus({
      orderId: second,
      to: OrderStatus.PENDING_PICK,
      actor: sys,
      reason: 't',
    });
    await ow.transitionStatus({ orderId: second, to: OrderStatus.PICKED, actor: sys, reason: 't' });
    await ow.transitionStatus({ orderId: second, to: OrderStatus.PACKED, actor: sys, reason: 't' });

    const refused = await request(h.baseUrl)
      .post(`/seller/orders/${second}/cancel`)
      .set(sellerAuth)
      .send({})
      .expect(409);
    expect(refused.body.code).toBe('NOT_CANCELLABLE');
    // The message has to name the reason — "cannot be cancelled" on a
    // packed parcel reads as a bug rather than as a rule.
    expect(refused.body.message).toContain('already packed');

    // And an admin still can, which is the whole point of the split.
    await request(h.baseUrl)
      .post(`/admin/orders/${second}/cancel`)
      .set(staffAuth)
      .send({ cancellationReason: 'CUSTOMER_REQUESTED', note: 'customer called us directly' })
      .expect(200);
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: second } });
    expect(row.status).toBe(OrderStatus.CANCELLED_BY_ADMIN);
  });

  it("refuses to cancel another seller's order without revealing it exists", async () => {
    const orderId = await placeOrder();

    const other = `other-${Date.now()}@brand.com`;
    const inv = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email: other })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: inv.body.token,
        companyName: 'Other Brand',
        contactPersonName: 'Other Owner',
        phone: '+8801712345692',
        password: 'SellerPass-1234',
      })
      .expect(201);

    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/cancel`)
      .set({ Authorization: `Bearer ${reg.body.accessToken}` })
      .send({})
      .expect(404);

    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(row.status).toBe(OrderStatus.PENDING_CONFIRMATION);
  });
});
