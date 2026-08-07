import request from 'supertest';
import {
  ActorType,
  OrderStatus,
  ReservationStatus,
  ShipmentStatus,
  StaffRole,
  StockMovementType,
} from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  claimPick,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

/**
 * Module 9 commit 14 — manual courier placement e2e (CUR-8).
 *
 * Drives the AWB-failure path: an order to a stub-failing pincode
 * (stub-mode 999999 — transient courier failure) → AWB job fails →
 * shipment auto-superseded → order routed PENDING_MANUAL_PLACEMENT.
 * Then exercises:
 *   - place-awb: record a manual courier AWB on the replacement shipment
 *     → order DISPATCHED (Model-A qtyOnHand decrement), shipment
 *     isManualCourier + HANDED_TO_COURIER.
 *   - cancel: PENDING_MANUAL_PLACEMENT → CANCELLED_BY_ADMIN, reservations
 *     released, qtyOnHand untouched (nothing dispatched).
 *   - RBAC: a non-MANUAL_PLACEMENT_ADMIN is rejected 403.
 */
describe('Manual courier placement (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let sellerAuth: { Authorization: string };
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
    staffId = staff.id;
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const email = `mp-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'MP Brand',
        contactPersonName: 'MP Owner',
        phone: '+8801712345684',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

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
      .send({
        lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }],
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  /** Drive an order to a FAILING pincode (stub 999999 — transient courier failure) through
   *  pick → pack → manifest close → AWB job FAILS → auto-supersede →
   *  order PENDING_MANUAL_PLACEMENT. Returns the live replacement
   *  shipment id. */
  async function driveToManualPlacement(qty = 2): Promise<{
    orderId: string;
    oldShipmentId: string;
    replacementShipmentId: string;
  }> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Asha Verma',
        recipientPhoneE164: '+919876543210',
        // Fixture: several orders for one customer on purpose.
        acknowledgeDuplicate: true,
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientCity: 'Bengaluru',
        recipientStateProvince: 'Karnataka',
        recipientPostalCode: '999999', // stub → courier failure → supersede
        paymentMode: 'COD',
        codAmountInr: 999,
        items: [{ variantId, quantity: qty }],
      })
      .expect(201);
    const orderId = created.body.id as string;
    await request(h.baseUrl).post(`/seller/orders/${orderId}/submit`).set(sellerAuth).expect(200);
    await h.app.get(OrderWriteService).transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });
    const oldShipmentId = shipment.id;

    // The AWB is generated at confirmation on a BullMQ job, and while
    // it runs it holds a row lock the pick's SKIP LOCKED pull skips
    // past — so a pull issued microseconds later can hand back a
    // different parcel. Correct in production; a test needs the
    // specific one. See claimPick.
    await claimPick(h.baseUrl, staffAuth, oldShipmentId);
    const resv = await h.prisma.stockReservation.findFirstOrThrow({
      where: { orderId, status: 'ACTIVE', NOT: { binId: null } },
    });
    const items = await h.prisma.shipmentItem.findMany({
      where: { shipmentId: oldShipmentId },
      select: { id: true },
    });
    await request(h.baseUrl)
      .post(`/warehouse/picks/${oldShipmentId}/items`)
      .set(staffAuth)
      .send({
        shipmentItemId: items[0]!.id,
        pickedBinId: resv.binId,
        pickedBatchId: resv.batchId,
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${oldShipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    const pack = await request(h.baseUrl)
      .post(`/warehouse/packs/${oldShipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${pack.body.manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    // close enqueues the AWB job; the in-process worker generates — the
    // stub fails 999999 (transient courier failure) → supersede → the
    // order is routed PENDING_MANUAL_PLACEMENT. Wait for the REPLACEMENT
    // shipment to exist: the AWB job routes the order to manual FIRST,
    // then supersedes — so the replacement is the last-written marker.
    const replacement = await waitFor(
      async () => {
        return h.prisma.shipment.findFirst({
          where: { supersedesShipmentId: oldShipmentId },
        });
      },
      {
        timeoutMs: 15_000,
        description: 'replacement shipment created (auto-supersede done)',
      },
    );
    return { orderId, oldShipmentId, replacementShipmentId: replacement.id };
  }

  async function stockOf(): Promise<{ qtyOnHand: number; qtyReserved: number }> {
    const level = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    return { qtyOnHand: level.qtyOnHand, qtyReserved: level.qtyReserved };
  }

  it('place-awb: records the manual AWB, dispatches the order, decrements qtyOnHand 10→8', async () => {
    await receiveStock(10);
    const { orderId, oldShipmentId, replacementShipmentId } = await driveToManualPlacement(2);

    expect(await stockOf()).toEqual({ qtyOnHand: 10, qtyReserved: 2 });

    const res = await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/place-awb`)
      .set(staffAuth)
      .send({ awbNumber: 'BLUEDART-AWB-001', courierName: 'Bluedart' })
      .expect(200);
    expect(res.body).toMatchObject({
      shipmentId: replacementShipmentId,
      orderId,
      awbNumber: 'BLUEDART-AWB-001',
      orderStatus: OrderStatus.DISPATCHED,
      shipmentStatus: ShipmentStatus.HANDED_TO_COURIER,
      alreadyPlaced: false,
    });

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DISPATCHED);

    const replacement = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: replacementShipmentId },
    });
    expect(replacement.status).toBe(ShipmentStatus.HANDED_TO_COURIER);
    expect(replacement.isManualCourier).toBe(true);
    expect(replacement.courierCode).toBe('manual');
    expect(replacement.awbNumber).toBe('BLUEDART-AWB-001');
    expect(replacement.serviceType).toBe('Bluedart');

    // Model A: the DISPATCH movement decremented qtyOnHand, keyed to the
    // live replacement shipment (NOT the superseded old one).
    expect(await stockOf()).toEqual({ qtyOnHand: 8, qtyReserved: 0 });
    const dispatchMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.DISPATCH },
    });
    expect(dispatchMovements).toHaveLength(1);
    expect(dispatchMovements[0]!.qtyChange).toBe(-2);
    expect(dispatchMovements[0]!.shipmentId).toBe(replacementShipmentId);
    expect(dispatchMovements[0]!.shipmentId).not.toBe(oldShipmentId);

    const active = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
    });
    expect(active).toHaveLength(0);
  });

  it('place-awb is idempotent: a 2nd call is alreadyPlaced, no double decrement', async () => {
    await receiveStock(10);
    const { orderId, replacementShipmentId } = await driveToManualPlacement(2);

    await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/place-awb`)
      .set(staffAuth)
      .send({ awbNumber: 'BLUEDART-AWB-002' })
      .expect(200);
    const second = await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/place-awb`)
      .set(staffAuth)
      .send({ awbNumber: 'BLUEDART-AWB-002' })
      .expect(200);
    expect(second.body.alreadyPlaced).toBe(true);

    const dispatchMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.DISPATCH },
    });
    expect(dispatchMovements).toHaveLength(1);
    expect((await stockOf()).qtyOnHand).toBe(8);
  });

  it('cancel: an unfulfillable order → CANCELLED_BY_ADMIN, reservations released, qtyOnHand untouched', async () => {
    await receiveStock(10);
    const { orderId, replacementShipmentId } = await driveToManualPlacement(2);

    const res = await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/cancel`)
      .set(staffAuth)
      .send({ reason: 'No courier serves this pincode at all' })
      .expect(200);
    expect(res.body).toMatchObject({
      orderId,
      orderStatus: OrderStatus.CANCELLED_BY_ADMIN,
      alreadyCancelled: false,
    });

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.CANCELLED_BY_ADMIN);

    // RELEASE_STOCK released the reservations; nothing dispatched so
    // qtyOnHand is untouched.
    expect(await stockOf()).toEqual({ qtyOnHand: 10, qtyReserved: 0 });
    const active = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
    });
    expect(active).toHaveLength(0);
    const released = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.RELEASED },
    });
    expect(released.length).toBeGreaterThanOrEqual(1);
    const dispatchMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.DISPATCH },
    });
    expect(dispatchMovements).toHaveLength(0);
  });

  it('cancel is idempotent: a 2nd cancel is alreadyCancelled', async () => {
    await receiveStock(10);
    const { replacementShipmentId } = await driveToManualPlacement(2);

    await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/cancel`)
      .set(staffAuth)
      .send({ reason: 'No courier serves this pincode at all' })
      .expect(200);
    const second = await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/cancel`)
      .set(staffAuth)
      .send({ reason: 'No courier serves this pincode at all' })
      .expect(200);
    expect(second.body.alreadyCancelled).toBe(true);
  });

  it('place-awb requires MANUAL_PLACEMENT_ADMIN / SUPER_ADMIN — a call agent is rejected 403', async () => {
    await receiveStock(10);
    const { replacementShipmentId } = await driveToManualPlacement(2);

    const agent = await createTestStaff(h.prisma, {
      email: `agent-${Date.now()}@skydrop.test`,
      role: StaffRole.CALL_AGENT,
    });
    const aLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: agent.email, password: agent.password })
      .expect(200);

    await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/place-awb`)
      .set({ Authorization: `Bearer ${aLogin.body.accessToken}` })
      .send({ awbNumber: 'BLUEDART-AWB-003' })
      .expect(403);
  });

  it('place-awb on a MANUAL_PLACEMENT_ADMIN works (role is sufficient)', async () => {
    await receiveStock(10);
    const { orderId, replacementShipmentId } = await driveToManualPlacement(2);

    const mpa = await createTestStaff(h.prisma, {
      email: `mpa-${Date.now()}@skydrop.test`,
      role: StaffRole.MANUAL_PLACEMENT_ADMIN,
    });
    const mLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: mpa.email, password: mpa.password })
      .expect(200);

    await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementShipmentId}/place-awb`)
      .set({ Authorization: `Bearer ${mLogin.body.accessToken}` })
      .send({ awbNumber: 'BLUEDART-AWB-004' })
      .expect(200);

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DISPATCHED);
  });
});
