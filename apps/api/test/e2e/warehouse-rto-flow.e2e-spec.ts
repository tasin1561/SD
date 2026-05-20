import request from 'supertest';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
  RtoItemCondition,
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
 * Module 8 warehouse-rto HTTP surface (commits 14 + 15, WMS-8).
 * Drives the FULL CONFIRMED → pack → DISPATCHED → RTO_INITIATED →
 * receive → inspect → finalize pipeline through the HTTP layer +
 * asserts the WMS-8 two-gate Option A atomicity contract.
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

  /** Drive an order all the way to RTO_INITIATED with a manually-set AWB. */
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
    const prov = await h.app.get(ShipmentProvisionService).provisionFromSnapshot({
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
    const shipmentId = prov.shipmentId;

    // Pick.
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

    // Pack (auto-attaches to a DRAFT manifest).
    const pack = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);

    // Close manifest → PACKED → PENDING_DISPATCH.
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${pack.body.manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    // Drive through DISPATCHED → RTO_INITIATED (via the OrderWriteService
    // directly — M9 courier integration would normally drive these).
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

    // Stamp an AWB on the shipment (M9 will auto-generate; for now we
    // set it directly so the receive lookup-by-AWB works).
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

  it('full RTO flow: receive → inspect → finalize (all RESTOCK; stock returned, order RTO_RESTOCKED)', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, shipmentItemIds, awbNumber } =
      await makeRtoInitiatedShipment(2);

    // After pick, on-hand decreased by 2; restock should put it back.
    const levelBeforeRto = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });

    const recv = await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(recv.body.status).toBe(OrderStatus.RTO_RECEIVED);
    expect(recv.body.alreadyReceived).toBe(false);

    // Inspect every line as RESTOCK.
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
    });

    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe(OrderStatus.RTO_RESTOCKED);

    const levelAfter = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(levelAfter.qtyOnHand).toBe(levelBeforeRto.qtyOnHand + 2);

    const restockMovements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(restockMovements).toHaveLength(1);
    expect(restockMovements[0]!.qtyChange).toBe(2);
    expect(restockMovements[0]!.reasonCode).toBeNull();
  });

  it('idempotency gate 2: pre-existing RETURN_RESTOCK movement → skip re-apply, transition runs', async () => {
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
          condition: RtoItemCondition.GOOD,
          disposition: RtoDisposition.RESTOCK,
        })
        .expect(200);
    }

    // Simulate a prior crash-after-movements: write a RETURN_RESTOCK
    // movement directly (bypassing the service) so the gate fires.
    // INV-1 violation in test-only context — exclusively a crash-recovery
    // simulator; not a code path the app ever takes.
    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    await h.prisma.stockMovement.create({
      data: {
        sellerId: order.sellerId,
        variantId,
        warehouseId,
        binId,
        batchId: (await h.prisma.stockBatch.findFirstOrThrow({ where: { variantId } })).id,
        type: StockMovementType.RETURN_RESTOCK,
        qtyChange: 0, // marker; the gate only checks existence
        qtyBefore: 0,
        qtyAfter: 0,
        actorType: ActorType.SYSTEM,
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

    // Only the manually-inserted marker movement exists (no double-apply).
    const movements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(movements).toHaveLength(1);
  });

  it('idempotency gate 1: re-finalize after success → alreadyFinalized, no extra movements', async () => {
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
          condition: RtoItemCondition.GOOD,
          disposition: RtoDisposition.RESTOCK,
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
    expect(second.body.movementsAlreadyApplied).toBe(true);

    const movements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(movements).toHaveLength(1); // only one restock, despite two finalize calls
  });

  it('finalize rejects RTO_INSPECTION_INCOMPLETE when an item is unrinspected', async () => {
    await receiveStock(10);
    const { shipmentId, awbNumber } = await makeRtoInitiatedShipment(2);
    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    // Skip inspection — call finalize directly.
    const r = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(409);
    expect(r.body.code).toBe('RTO_INSPECTION_INCOMPLETE');
  });

  it('finalize all-WRITE_OFF: order RTO_RESTOCKED with no movements, original PICK decrement stands', async () => {
    await receiveStock(10);
    const { shipmentId, shipmentItemIds, awbNumber } =
      await makeRtoInitiatedShipment(2);
    const onHandAfterPick = (
      await h.prisma.stockLevel.findFirstOrThrow({ where: { variantId, binId } })
    ).qtyOnHand;

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
          notes: 'damaged in transit',
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
    });
    // Stock NOT restored — original PICK decrement stands.
    const after = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(after.qtyOnHand).toBe(onHandAfterPick);
    // No RETURN_RESTOCK movements.
    const movements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(movements).toHaveLength(0);
  });
});
