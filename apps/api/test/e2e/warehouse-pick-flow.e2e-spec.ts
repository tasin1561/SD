import request from 'supertest';
import { ActorType, OrderStatus, ShipmentStatus, StaffRole } from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Module 8 warehouse-pick HTTP surface (commit 8). Exercises the picker
 * happy path end-to-end (pull → start → recordItem → complete) and the
 * supervisor force-expire path (WMS-5 manual trigger + role gate).
 */
describe('Warehouse pick flow (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let sellerAuth: { Authorization: string };
  let warehouseId: string;
  let binId: string;
  let variantId: string;
  let skuCode: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma); // SUPER_ADMIN by default
    staffId = staff.id;
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const email = `pick-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Pick Brand',
        contactPersonName: 'Pick Owner',
        phone: '+8801712345677',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const whs = await request(h.baseUrl)
      .get('/admin/warehouses')
      .set(staffAuth)
      .expect(200);
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
      .send({ zoneId: zone.body.id, code: 'A-1-1', type: 'STORAGE' })
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
    skuCode = 'W-1-STD';
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
      .send({
        lines: [
          { lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId },
        ],
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  async function createConfirmedOrder(qty = 2): Promise<string> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Asha Verma',
        recipientPhoneE164: '+919876543210',
        recipientAddressLine1: '12 MG Road',
        recipientCity: 'Bengaluru',
        recipientStateProvince: 'Karnataka',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        codAmountInr: 999,
        items: [{ variantId, quantity: qty }],
      })
      .expect(201);
    const id = created.body.id as string;
    await request(h.baseUrl)
      .post(`/seller/orders/${id}/submit`)
      .set(sellerAuth)
      .expect(200);
    await h.app.get(OrderWriteService).transitionStatus({
      orderId: id,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    return id;
  }

  async function provisionShipment(orderId: string): Promise<string> {
    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    const r = await h.app.get(ShipmentProvisionService).provisionFromSnapshot({
      orderId,
      recipient: {
        name: order.recipientName,
        phoneE164: order.recipientPhoneE164,
        addressLine1: order.recipientAddressLine1,
        city: order.recipientCity,
        stateProvince: order.recipientStateProvince,
        postalCode: order.recipientPostalCode,
      },
      declaredValueInr: order.declaredValueInr,
      items: order.items.map((i) => ({
        orderItemId: i.id,
        quantity: i.quantity,
        skuCode,
        productName: 'Widget',
      })),
    });
    return r.shipmentId;
  }

  it('picker happy path: pullNext → start → recordItem → complete (PICKED)', async () => {
    await receiveStock(10);
    const orderId = await createConfirmedOrder(2);
    const shipmentId = await provisionShipment(orderId);

    // pullNext claims the shipment
    const next = await request(h.baseUrl)
      .post('/warehouse/picks/next')
      .set(staffAuth)
      .expect(200);
    expect(next.body.pick).not.toBeNull();
    expect(next.body.pick.shipmentId).toBe(shipmentId);
    expect(next.body.pick.items).toHaveLength(1);
    const shipmentItemId = next.body.pick.items[0].shipmentItemId as string;

    const claimed = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    });
    expect(claimed.pickStartedAt).not.toBeNull();
    expect(claimed.pickStartedByStaffId).toBe(staffId);

    // start: CONFIRMED → PENDING_PICK + allocate
    const started = await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/start`)
      .set(staffAuth)
      .expect(200);
    expect(started.body.status).toBe(OrderStatus.PENDING_PICK);
    expect(started.body.fullyAllocated).toBe(true);

    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe(OrderStatus.PENDING_PICK);

    // The phase-2 reservation should have bin+batch populated.
    const resvs = await h.prisma.stockReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });
    const phase2 = resvs.filter((r) => r.binId !== null);
    expect(phase2).toHaveLength(1);
    const batchId = phase2[0]!.batchId!;
    const pickedBinId = phase2[0]!.binId!;

    // recordItem
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/items`)
      .set(staffAuth)
      .send({ shipmentItemId, pickedBinId, pickedBatchId: batchId })
      .expect(200);

    // complete: PENDING_PICK → PICKED
    const completed = await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    expect(completed.body.status).toBe(OrderStatus.PICKED);

    const final = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(final.status).toBe(OrderStatus.PICKED);
    const finalShipment = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    });
    expect(finalShipment.pickCompletedAt).not.toBeNull();
    expect(finalShipment.pickExpiresAt).toBeNull();
    expect(finalShipment.status).toBe(ShipmentStatus.CREATED); // still CREATED until AWB (M9)
  });

  it('pullNext returns pick:null when queue is empty', async () => {
    const next = await request(h.baseUrl)
      .post('/warehouse/picks/next')
      .set(staffAuth)
      .expect(200);
    expect(next.body.pick).toBeNull();
  });

  it('supervisor force-expire: clears claim + releases allocation', async () => {
    await receiveStock(10);
    const orderId = await createConfirmedOrder(2);
    const shipmentId = await provisionShipment(orderId);

    // Picker pulls and starts (so phase-2 holds exist on stock_levels).
    await request(h.baseUrl)
      .post('/warehouse/picks/next')
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/start`)
      .set(staffAuth)
      .expect(200);

    const beforeLevel = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(beforeLevel.qtyReserved).toBe(2); // phase-2 holds active

    // Supervisor force-expires.
    const r = await request(h.baseUrl)
      .post(`/admin/warehouse/picks/${shipmentId}/expire`)
      .set(staffAuth)
      .expect(200);
    expect(r.body.expired).toBe(true);

    const after = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    });
    expect(after.pickStartedAt).toBeNull();
    expect(after.pickExpiresAt).toBeNull();
    expect(after.pickStartedByStaffId).toBeNull();

    // Phase-2 holds collapsed back to phase-1 → stock_levels.qtyReserved cleared.
    const afterLevel = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(afterLevel.qtyReserved).toBe(0);
    const resvs = await h.prisma.stockReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });
    expect(resvs).toHaveLength(1);
    expect(resvs[0]!.binId).toBeNull(); // collapsed back to phase-1
  });

  it('supervisor force-expire: 403 INSUFFICIENT_ROLE when role lacks supervisor/super_admin', async () => {
    const agent = await createTestStaff(h.prisma, {
      role: StaffRole.CALL_AGENT,
    });
    const aLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: agent.email, password: agent.password })
      .expect(200);
    const agentAuth = { Authorization: `Bearer ${aLogin.body.accessToken}` };

    await receiveStock(5);
    const orderId = await createConfirmedOrder(1);
    const shipmentId = await provisionShipment(orderId);

    const denied = await request(h.baseUrl)
      .post(`/admin/warehouse/picks/${shipmentId}/expire`)
      .set(agentAuth)
      .expect(403);
    expect(denied.body.code).toBe('INSUFFICIENT_ROLE');
  });
});
