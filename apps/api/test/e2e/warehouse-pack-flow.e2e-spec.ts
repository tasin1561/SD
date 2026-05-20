import request from 'supertest';
import {
  ActorType,
  ManifestStatus,
  OrderStatus,
  ShipmentStatus,
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
 * Module 8 warehouse-pack HTTP surface (commit 10). Exercises the full
 * pick → pack pipeline end-to-end (pickComplete → PICKED; then
 * packPullNext → packComplete → PACKED + auto-attached to a DRAFT
 * manifest, WMS-7).
 */
describe('Warehouse pack flow (e2e)', () => {
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

    const email = `pack-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Pack Brand',
        contactPersonName: 'Pack Owner',
        phone: '+8801712345678',
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

  async function makePickedShipment(qty = 2): Promise<{
    orderId: string;
    shipmentId: string;
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
    await h.app.get(OrderWriteService).transitionStatus({
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

    // Drive through pick.
    await request(h.baseUrl)
      .post('/warehouse/picks/next')
      .set(staffAuth)
      .expect(200);
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

    return { orderId, shipmentId };
  }

  it('packer happy path: pullNext → complete (PACKED + DRAFT manifest auto-attached)', async () => {
    await receiveStock(10);
    const { orderId, shipmentId } = await makePickedShipment();

    const next = await request(h.baseUrl)
      .post('/warehouse/packs/next')
      .set(staffAuth)
      .expect(200);
    expect(next.body.pack).not.toBeNull();
    expect(next.body.pack.shipmentId).toBe(shipmentId);

    const completed = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    expect(completed.body.status).toBe(OrderStatus.PACKED);
    expect(completed.body.alreadyComplete).toBe(false);
    expect(completed.body.manifestId).not.toBeNull();
    expect(completed.body.manifestNumber).toMatch(/^MF-\d{4}-\d{2}-\d{6}$/);

    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe(OrderStatus.PACKED);

    const shipment = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    });
    expect(shipment.status).toBe(ShipmentStatus.CREATED); // still CREATED until M9 AWB
    expect(shipment.packCompletedAt).not.toBeNull();
    expect(shipment.packedByStaffId).toBe(staffId);
    expect(shipment.manifestId).toBe(completed.body.manifestId);

    const manifest = await h.prisma.manifest.findUniqueOrThrow({
      where: { id: completed.body.manifestId as string },
    });
    expect(manifest.status).toBe(ManifestStatus.DRAFT);
    expect(manifest.courierCode).toBe(shipment.courierCode);
    expect(manifest.originWarehouseId).toBe(shipment.originWarehouseId);
  });

  it('two PICKED shipments → second pack reuses the same DRAFT manifest', async () => {
    await receiveStock(10);
    const a = await makePickedShipment(2);
    const b = await makePickedShipment(3);

    const pA = await request(h.baseUrl)
      .post(`/warehouse/packs/${a.shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    const pB = await request(h.baseUrl)
      .post(`/warehouse/packs/${b.shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);

    expect(pB.body.manifestId).toBe(pA.body.manifestId);
    const manifests = await h.prisma.manifest.count();
    expect(manifests).toBe(1);
  });

  it('pullNext returns pack:null when no PICKED shipments are queued', async () => {
    const next = await request(h.baseUrl)
      .post('/warehouse/packs/next')
      .set(staffAuth)
      .expect(200);
    expect(next.body.pack).toBeNull();
  });

  it('complete is idempotent on already-PACKED+stamped (alreadyComplete:true)', async () => {
    await receiveStock(10);
    const { shipmentId } = await makePickedShipment();

    const first = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    expect(first.body.alreadyComplete).toBe(false);

    const second = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    expect(second.body.alreadyComplete).toBe(true);
    expect(second.body.status).toBe(OrderStatus.PACKED);
    expect(second.body.manifestId).toBe(first.body.manifestId);
  });
});
