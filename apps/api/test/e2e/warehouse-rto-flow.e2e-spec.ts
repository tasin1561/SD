import request from 'supertest';
import {
  ActorType,
  OrderStatus,
  ReservationStatus,
  RtoDisposition,
  RtoItemCondition,
  StockMovementReasonCode,
  StockMovementType,
} from '@skydrop/db';
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
 * Module 8 warehouse-rto HTTP surface (commits 14 + 15 + the
 * conservation bug-fix follow-on). Drives the FULL CONFIRMED → pack →
 * DISPATCHED → RTO_INITIATED → receive → inspect → finalize pipeline.
 *
 * Post-fix semantics (model B — qtyOnHand only changes when goods truly
 * leave permanently; pre-DELIVERED never decrements; tracked as latent
 * debt for M9/M10):
 *   - RESTOCK : release() the phase-2 reservation → qtyReserved
 *               clamped-decrements. NO RETURN_RESTOCK movement. qtyOnHand
 *               unchanged (was never decremented).
 *   - WRITE_OFF: release() the reservation + ADJUSTMENT_DECREASE -qty
 *                with reasonCode mapped from rtoCondition.
 */
describe('Warehouse RTO flow (e2e)', () => {
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
    await resetAuthState(h.prisma);

    const staff = await createTestStaff(h.prisma);
    staffId = staff.id;
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const email = `rto-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'RTO Brand',
        contactPersonName: 'RTO Owner',
        phone: '+8801712345680',
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

  async function makeRtoInitiatedShipment(qty = 2): Promise<{
    orderId: string;
    shipmentId: string;
    shipmentItemIds: string[];
    awbNumber: string;
  }> {
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
    const orderId = created.body.id as string;
    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/submit`)
      .set(sellerAuth)
      .expect(200);
    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    // commit-16 auto-provisions; redundant call is idempotent.
    await h.app.get(ShipmentProvisionService).provisionFromSnapshot({
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
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });
    const shipmentId = shipment.id;

    await request(h.baseUrl).post('/warehouse/picks/next').set(staffAuth).expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/start`)
      .set(staffAuth)
      .expect(200);
    const resv = await h.prisma.stockReservation.findFirstOrThrow({
      where: { orderId, status: 'ACTIVE', NOT: { binId: null } },
    });
    const items = await h.prisma.shipmentItem.findMany({
      where: { shipmentId },
      select: { id: true },
    });
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/items`)
      .set(staffAuth)
      .send({
        shipmentItemId: items[0]!.id,
        pickedBinId: resv.binId,
        pickedBatchId: resv.batchId,
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);

    const pack = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${pack.body.manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    await ow.transitionStatus({
      orderId,
      to: OrderStatus.DISPATCHED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.RTO_INITIATED,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    const awbNumber = `AWB-TEST-${Date.now()}`;
    await h.prisma.shipment.update({
      where: { id: shipmentId },
      data: { awbNumber },
    });

    return {
      orderId,
      shipmentId,
      shipmentItemIds: items.map((i) => i.id),
      awbNumber,
    };
  }

  it('RESTOCK happy: release-only — qtyReserved cleared, qtyOnHand unchanged, no RETURN_RESTOCK movement, reservation status RELEASED', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, shipmentItemIds, awbNumber } =
      await makeRtoInitiatedShipment(2);

    // After pick-start, phase-2 hold raised stock_levels.qtyReserved by 2.
    const beforeFinalize = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(beforeFinalize.qtyOnHand).toBe(10);
    expect(beforeFinalize.qtyReserved).toBe(2);

    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    for (const itemId of shipmentItemIds) {
      await request(h.baseUrl)
        .post(`/warehouse/rto/items/${itemId}/inspect`)
        .set(staffAuth)
        .send({
          condition: RtoItemCondition.GOOD,
          disposition: RtoDisposition.RESTOCK,
        })
        .expect(200);
    }
    const fin = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);
    expect(fin.body).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      restockedCount: 1,
      writtenOffCount: 0,
      movementsAlreadyApplied: false,
      alreadyFinalized: false,
      reservationsReleased: 1,
    });

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_RESTOCKED);

    const afterFinalize = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(afterFinalize.qtyOnHand).toBe(10); // unchanged — model B
    expect(afterFinalize.qtyReserved).toBe(0); // release decremented the hold

    // No RETURN_RESTOCK movement was issued (the bug-fix removed it).
    const restockMovements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(restockMovements).toHaveLength(0);

    // No ACTIVE reservations leaked — RTO conservation invariant.
    const active = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
    });
    expect(active).toHaveLength(0);
    const released = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.RELEASED },
    });
    expect(released.length).toBeGreaterThanOrEqual(1);
  });

  it('WRITE_OFF happy: release + ADJUSTMENT_DECREASE with rtoCondition-mapped reasonCode (DAMAGED → DAMAGED_IN_WAREHOUSE)', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, shipmentItemIds, awbNumber } =
      await makeRtoInitiatedShipment(2);

    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    for (const itemId of shipmentItemIds) {
      await request(h.baseUrl)
        .post(`/warehouse/rto/items/${itemId}/inspect`)
        .set(staffAuth)
        .send({
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.WRITE_OFF,
          notes: 'box crushed',
        })
        .expect(200);
    }
    const fin = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);
    expect(fin.body).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      restockedCount: 0,
      writtenOffCount: 1,
      reservationsReleased: 1,
    });

    const afterFinalize = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(afterFinalize.qtyOnHand).toBe(8); // ADJUSTMENT_DECREASE -2: the 2 units truly left
    expect(afterFinalize.qtyReserved).toBe(0); // release cleared the hold

    const adjustments = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.ADJUSTMENT_DECREASE },
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.qtyChange).toBe(-2);
    expect(adjustments[0]!.reasonCode).toBe(
      StockMovementReasonCode.DAMAGED_IN_WAREHOUSE,
    );

    const active = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
    });
    expect(active).toHaveLength(0);
  });

  it('gate-2 (WRITE_OFF): pre-existing ADJUSTMENT_DECREASE marker → skip re-apply, transition still runs', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, shipmentItemIds, awbNumber } =
      await makeRtoInitiatedShipment(2);

    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    for (const itemId of shipmentItemIds) {
      await request(h.baseUrl)
        .post(`/warehouse/rto/items/${itemId}/inspect`)
        .set(staffAuth)
        .send({
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.WRITE_OFF,
        })
        .expect(200);
    }

    // Simulate prior crash-after-movements: insert an ADJUSTMENT_DECREASE
    // marker directly so the gate fires. Test-only INV-1 bypass; this
    // path is NEVER taken by app code.
    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    await h.prisma.stockMovement.create({
      data: {
        sellerId: order.sellerId,
        variantId,
        warehouseId,
        binId,
        batchId: (await h.prisma.stockBatch.findFirstOrThrow({ where: { variantId } })).id,
        type: StockMovementType.ADJUSTMENT_DECREASE,
        qtyChange: 0, // marker; only existence matters for the gate
        qtyBefore: 0,
        qtyAfter: 0,
        actorType: ActorType.SYSTEM,
        reasonCode: StockMovementReasonCode.OTHER,
        orderId,
        shipmentId,
      },
    });

    const fin = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);
    expect(fin.body.movementsAlreadyApplied).toBe(true);
    expect(fin.body.status).toBe(OrderStatus.RTO_RESTOCKED);

    // Only the manually-inserted marker — no double-apply.
    const adjustments = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.ADJUSTMENT_DECREASE },
    });
    expect(adjustments).toHaveLength(1);
  });

  it('gate-1 idempotency: re-finalize after success → alreadyFinalized, no double-release, no extra movements', async () => {
    await receiveStock(10);
    const { shipmentId, shipmentItemIds, awbNumber } =
      await makeRtoInitiatedShipment(2);

    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    for (const itemId of shipmentItemIds) {
      await request(h.baseUrl)
        .post(`/warehouse/rto/items/${itemId}/inspect`)
        .set(staffAuth)
        .send({
          condition: RtoItemCondition.DAMAGED,
          disposition: RtoDisposition.WRITE_OFF,
        })
        .expect(200);
    }
    await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);

    const second = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);
    expect(second.body.alreadyFinalized).toBe(true);

    const adjustments = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.ADJUSTMENT_DECREASE },
    });
    expect(adjustments).toHaveLength(1);
  });

  it('finalize rejects RTO_INSPECTION_INCOMPLETE when an item is uninspected', async () => {
    await receiveStock(10);
    const { shipmentId, awbNumber } = await makeRtoInitiatedShipment(2);
    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    const r = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(409);
    expect(r.body.code).toBe('RTO_INSPECTION_INCOMPLETE');
  });
});
