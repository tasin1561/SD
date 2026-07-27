import request from 'supertest';
import { ActorType, ManifestStatus, OrderStatus, ShipmentStatus, StaffRole } from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';
import {
  bootTestApp,
  createTestStaff,
  waitFor,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Module 8 warehouse-manifest HTTP surface (commit 13). Exercises the
 * full pick → pack → manifest-close pipeline + the supervisor move +
 * admin list/detail endpoints + the WAREHOUSE_SUPERVISOR role gate.
 */
describe('Warehouse manifest flow (e2e)', () => {
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

    const staff = await createTestStaff(h.prisma); // SUPER_ADMIN
    staffId = staff.id;
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const email = `manifest-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Manifest Brand',
        contactPersonName: 'Manifest Owner',
        phone: '+8801712345679',
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
        lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }],
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  async function makePackedShipment(qty = 2): Promise<{
    orderId: string;
    shipmentId: string;
    manifestId: string;
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
    await request(h.baseUrl).post(`/seller/orders/${orderId}/submit`).set(sellerAuth).expect(200);
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

    // Pack.
    const pack = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipmentId}/complete`)
      .set(staffAuth)
      .expect(200);
    return { orderId, shipmentId, manifestId: pack.body.manifestId };
  }

  it('list + getById: lists DRAFT manifests with shipmentCount; detail returns shipments', async () => {
    await receiveStock(10);
    const a = await makePackedShipment();
    const b = await makePackedShipment();
    expect(a.manifestId).toBe(b.manifestId); // shared DRAFT

    const list = await request(h.baseUrl)
      .get('/admin/warehouse/manifests')
      .set(staffAuth)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      id: a.manifestId,
      status: ManifestStatus.DRAFT,
      shipmentCount: 2,
    });

    const detail = await request(h.baseUrl)
      .get(`/admin/warehouse/manifests/${a.manifestId}`)
      .set(staffAuth)
      .expect(200);
    expect(detail.body.shipments.map((s: { id: string }) => s.id).sort()).toEqual(
      [a.shipmentId, b.shipmentId].sort(),
    );
  });

  it('close: DRAFT → CLOSED + per-shipment PACKED → PENDING_DISPATCH + AWB stub audit', async () => {
    await receiveStock(10);
    const a = await makePackedShipment();
    const b = await makePackedShipment();

    const closed = await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${a.manifestId}/close`)
      .set(staffAuth)
      .expect(200);
    expect(closed.body.status).toBe(ManifestStatus.CLOSED);
    expect(closed.body.transitionedCount).toBe(2);
    expect(closed.body.failures).toEqual([]);
    expect(closed.body.alreadyClosed).toBe(false);

    const orderA = await h.prisma.order.findUniqueOrThrow({
      where: { id: a.orderId },
    });
    const orderB = await h.prisma.order.findUniqueOrThrow({
      where: { id: b.orderId },
    });
    expect(orderA.status).toBe(OrderStatus.PENDING_DISPATCH);
    expect(orderB.status).toBe(OrderStatus.PENDING_DISPATCH);

    const manifest = await h.prisma.manifest.findUniqueOrThrow({
      where: { id: a.manifestId },
    });
    expect(manifest.closedByStaffId).toBe(staffId);
    expect(manifest.closedAt).not.toBeNull();
    expect(manifest.awbJobEnqueuedAt).not.toBeNull();

    // M9 commit 10: close enqueues the AWB job (replacing the M8 stub).
    // The in-process worker processes it asynchronously — wait for the
    // manifest to settle at CONFIRMED (stub-mode Delhivery → all AWBs
    // succeed), then assert the AWBs landed.
    const settled = await waitFor(
      async () => {
        const m = await h.prisma.manifest.findUniqueOrThrow({
          where: { id: a.manifestId },
        });
        return m.status === ManifestStatus.CONFIRMED ? m : null;
      },
      { timeoutMs: 15_000, description: 'manifest → CONFIRMED via AWB job' },
    );
    expect(settled.awbJobCompletedAt).not.toBeNull();
    const shA = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: a.shipmentId },
    });
    expect(shA.awbNumber).not.toBeNull();
    expect(shA.status).toBe(ShipmentStatus.AWB_GENERATED);

    // Idempotent re-close — the manifest is now CONFIRMED; re-close is a
    // no-op (alreadyClosed:true, not a 409 race).
    const again = await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${a.manifestId}/close`)
      .set(staffAuth)
      .expect(200);
    expect(again.body.alreadyClosed).toBe(true);
  });

  it('move: supervisor moves shipment between DRAFT manifests (same courier+warehouse)', async () => {
    await receiveStock(10);
    const a = await makePackedShipment();
    // Build a second DRAFT manifest by closing the first and pack-ing a new
    // shipment (so attachShipment creates a fresh DRAFT). Then re-create
    // ANOTHER DRAFT by closing the second so the move target is a fresh DRAFT.
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${a.manifestId}/close`)
      .set(staffAuth)
      .expect(200);
    const b = await makePackedShipment();
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${b.manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    // Two NEW packs land on a fresh DRAFT, then we close the third
    // DRAFT to free a target, build a fourth, and move between them.
    const c = await makePackedShipment();
    // Open a SECOND DRAFT by faking a different attach window: close
    // c.manifest then create d — but that's still serial. To get TWO
    // concurrently-open DRAFTs we leverage that close emits a stub but
    // does NOT prevent a future shipment from creating a NEW DRAFT.
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${c.manifestId}/close`)
      .set(staffAuth)
      .expect(200);
    const d = await makePackedShipment();
    const e = await makePackedShipment();
    expect(d.manifestId).toBe(e.manifestId); // both on the SAME fresh DRAFT

    // Manually create another DRAFT manifest by inserting a row (Phase 1A:
    // supervisors don't create empty manifests through the UI; for the
    // move test we bypass via Prisma directly).
    const targetManifest = await h.prisma.manifest.create({
      data: {
        manifestNumber: `MF-2026-05-TARGET${Date.now()}`,
        courierCode: 'delhivery',
        originWarehouseId: warehouseId,
        status: ManifestStatus.DRAFT,
      },
    });

    const moved = await request(h.baseUrl)
      .post(`/admin/warehouse/shipments/${e.shipmentId}/move-manifest`)
      .set(staffAuth)
      .send({ targetManifestId: targetManifest.id })
      .expect(200);
    expect(moved.body).toMatchObject({
      shipmentId: e.shipmentId,
      sourceManifestId: d.manifestId,
      targetManifestId: targetManifest.id,
      alreadyOnTarget: false,
    });

    const final = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: e.shipmentId },
    });
    expect(final.manifestId).toBe(targetManifest.id);
  });

  it('role gate: CALL_AGENT → 403 on list / detail / close / move', async () => {
    const agent = await createTestStaff(h.prisma, {
      role: StaffRole.CALL_AGENT,
    });
    const aLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: agent.email, password: agent.password })
      .expect(200);
    const agentAuth = { Authorization: `Bearer ${aLogin.body.accessToken}` };

    await receiveStock(5);
    const a = await makePackedShipment(1);

    await request(h.baseUrl).get('/admin/warehouse/manifests').set(agentAuth).expect(403);
    await request(h.baseUrl)
      .get(`/admin/warehouse/manifests/${a.manifestId}`)
      .set(agentAuth)
      .expect(403);
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${a.manifestId}/close`)
      .set(agentAuth)
      .expect(403);
    await request(h.baseUrl)
      .post(`/admin/warehouse/shipments/${a.shipmentId}/move-manifest`)
      .set(agentAuth)
      .send({ targetManifestId: a.manifestId })
      .expect(403);
  });
});
