import request from 'supertest';
import {
  ActorType,
  ManifestStatus,
  OrderStatus,
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
  settleAwb,
  waitFor,
  type AppHarness,
} from './app-harness';

/**
 * Module 9 commit 13 — supervisor dispatch endpoint e2e.
 *
 * Drives the real pipeline CONFIRMED → pick → pack → manifest close →
 * (AWB job) CONFIRMED, then exercises POST
 * /admin/courier/manifests/:id/confirm-handoff:
 *   - happy: order PENDING_DISPATCH → DISPATCHED, shipment
 *     HANDED_TO_COURIER, manifest CONFIRMED → DISPATCHED. Under Model C
 *     (2026-09-03) this edge is STOCK-NEUTRAL — the DISPATCH_STOCK
 *     qtyOnHand 10→8 decrement already fired earlier, at pack.complete
 *     (PICKED → PACKED), inside driveToConfirmedManifest.
 *   - idempotent: a 2nd confirm-handoff is alreadyDispatched, and no
 *     PACK_CONFIRM or DISPATCH movement is created by either call.
 *   - RBAC: a non-supervisor staff member is rejected 403.
 */
describe('Dispatch handoff endpoint (e2e)', () => {
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

    const email = `disp-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Disp Brand',
        contactPersonName: 'Disp Owner',
        phone: '+8801712345683',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

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
      .send({
        lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }],
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  /** Drive an order to PENDING_DISPATCH with an AWB-generated shipment in
   *  a CONFIRMED manifest — ready for the handoff endpoint. */
  async function driveToConfirmedManifest(qty = 2): Promise<{
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
        // Fixture: several orders for one customer on purpose.
        acknowledgeDuplicate: true,
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Near City Hospital',
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
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });
    const shipmentId = shipment.id;

    // The AWB is generated at confirmation on a BullMQ job, and while
    // it runs it holds a row lock the pick's SKIP LOCKED pull skips
    // past — so a pull issued microseconds later can hand back a
    // different parcel. Correct in production; a test needs the
    // specific one. See claimPick.
    await claimPick(h.baseUrl, staffAuth, shipmentId);
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
    const manifestId = pack.body.manifestId as string;
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    // close enqueues the AWB job; wait for the in-process worker to flip
    // the manifest CLOSED → CONFIRMED (AWB generated, stub-mode).
    await waitFor(
      async () => {
        const m = await h.prisma.manifest.findUniqueOrThrow({
          where: { id: manifestId },
        });
        return m.status === ManifestStatus.CONFIRMED ? m : null;
      },
      { timeoutMs: 15_000, description: 'manifest CONFIRMED (AWB job done)' },
    );

    return { orderId, shipmentId, manifestId };
  }

  /**
   * Drive an order to PACKED and STOP — no manifest close, no confirm
   * handoff. This is the ordinary shape once the bench dispatches: the
   * manifest is created for you at pack and nobody ever opens it.
   */
  async function driveToPacked(qty = 2): Promise<{
    orderId: string;
    shipmentId: string;
    manifestId: string;
    awbNumber: string;
  }> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Asha Verma',
        recipientPhoneE164: '+919876543210',
        acknowledgeDuplicate: true,
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Near City Hospital',
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
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });
    // The AWB is generated at confirmation (CUR-2b) — settle it before
    // picking so the pull is not racing the job's row lock.
    await settleAwb(h.prisma, shipment.id);
    await claimPick(h.baseUrl, staffAuth, shipment.id);
    const resv = await h.prisma.stockReservation.findFirstOrThrow({
      where: { orderId, status: 'ACTIVE', NOT: { binId: null } },
    });
    const items = await h.prisma.shipmentItem.findMany({
      where: { shipmentId: shipment.id },
      select: { id: true },
    });
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipment.id}/items`)
      .set(staffAuth)
      .send({
        shipmentItemId: items[0]!.id,
        pickedBinId: resv.binId,
        pickedBatchId: resv.batchId,
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipment.id}/complete`)
      .set(staffAuth)
      .expect(200);
    const pack = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipment.id}/complete`)
      .set(staffAuth)
      .expect(200);
    const withAwb = await h.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    return {
      orderId,
      shipmentId: shipment.id,
      manifestId: pack.body.manifestId as string,
      awbNumber: withAwb.awbNumber as string,
    };
  }

  async function stockOf(): Promise<{ qtyOnHand: number; qtyReserved: number }> {
    const level = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    return { qtyOnHand: level.qtyOnHand, qtyReserved: level.qtyReserved };
  }

  it('confirm-handoff: order → DISPATCHED, shipment HANDED_TO_COURIER, manifest DISPATCHED — stock already moved at pack', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, manifestId } = await driveToConfirmedManifest(2);

    // Model C: pack.complete (inside driveToConfirmedManifest) already
    // decremented qtyOnHand and fulfilled the reservation.
    const before = await stockOf();
    expect(before).toEqual({ qtyOnHand: 8, qtyReserved: 0 });
    const packMovementsBefore = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_CONFIRM },
    });
    expect(packMovementsBefore).toHaveLength(1);
    expect(packMovementsBefore[0]!.qtyChange).toBe(-2);

    const res = await request(h.baseUrl)
      .post(`/admin/courier/manifests/${manifestId}/confirm-handoff`)
      .set(staffAuth)
      .expect(200);
    expect(res.body).toMatchObject({
      manifestId,
      status: ManifestStatus.DISPATCHED,
      transitionedCount: 1,
      alreadyDispatched: false,
    });
    expect(res.body.dispatchedShipmentIds).toContain(shipmentId);
    expect(res.body.failures).toHaveLength(0);

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DISPATCHED);

    const shipment = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
    });
    expect(shipment.status).toBe(ShipmentStatus.HANDED_TO_COURIER);
    expect(shipment.pickedUpByCourierAt).not.toBeNull();

    const manifest = await h.prisma.manifest.findUniqueOrThrow({
      where: { id: manifestId },
    });
    expect(manifest.status).toBe(ManifestStatus.DISPATCHED);
    expect(manifest.handoffConfirmedByStaffId).toBe(staffId);

    // Model C: confirm-handoff is stock-neutral — nothing changes here,
    // and NO DISPATCH-type movement is ever issued any more.
    const after = await stockOf();
    expect(after).toEqual({ qtyOnHand: 8, qtyReserved: 0 });
    const dispatchMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.DISPATCH },
    });
    expect(dispatchMovements).toHaveLength(0);
    const packMovementsAfter = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_CONFIRM },
    });
    expect(packMovementsAfter).toHaveLength(1); // still just the one, from pack
    const active = await h.prisma.stockReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });
    expect(active).toHaveLength(0);
  });

  it('confirm-handoff is idempotent: a 2nd call is alreadyDispatched, and touches no stock (none did, under Model C)', async () => {
    await receiveStock(10);
    const { orderId, manifestId } = await driveToConfirmedManifest(2);

    await request(h.baseUrl)
      .post(`/admin/courier/manifests/${manifestId}/confirm-handoff`)
      .set(staffAuth)
      .expect(200);
    const second = await request(h.baseUrl)
      .post(`/admin/courier/manifests/${manifestId}/confirm-handoff`)
      .set(staffAuth)
      .expect(200);
    expect(second.body.alreadyDispatched).toBe(true);
    expect(second.body.transitionedCount).toBe(0);

    // No DISPATCH movement is ever created (Model C); exactly one
    // PACK_CONFIRM movement, from pack.complete, unaffected by either call.
    const dispatchMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.DISPATCH },
    });
    expect(dispatchMovements).toHaveLength(0);
    const packMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_CONFIRM },
    });
    expect(packMovements).toHaveLength(1);
    expect((await stockOf()).qtyOnHand).toBe(8);
  });

  it('confirm-handoff requires WAREHOUSE_SUPERVISOR / SUPER_ADMIN — a picker is rejected 403', async () => {
    await receiveStock(10);
    const { manifestId } = await driveToConfirmedManifest(2);

    const picker = await createTestStaff(h.prisma, {
      email: `picker-${Date.now()}@skydrop.test`,
      role: StaffRole.WAREHOUSE_STAFF,
    });
    const pLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: picker.email, password: picker.password })
      .expect(200);

    await request(h.baseUrl)
      .post(`/admin/courier/manifests/${manifestId}/confirm-handoff`)
      .set({ Authorization: `Bearer ${pLogin.body.accessToken}` })
      .expect(403);
  });

  it('confirm-handoff on a non-CONFIRMED manifest → 409 MANIFEST_NOT_DISPATCHABLE', async () => {
    await receiveStock(10);
    // A DRAFT manifest (pack done, not closed) is not dispatchable.
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Asha Verma',
        recipientPhoneE164: '+919876543210',
        // Fixture: several orders for one customer on purpose.
        acknowledgeDuplicate: true,
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Opposite the school',
        recipientCity: 'Bengaluru',
        recipientStateProvince: 'Karnataka',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        codAmountInr: 999,
        items: [{ variantId, quantity: 2 }],
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
    // Pull until THIS parcel comes back: the AWB job (fired at
    // confirmation) holds a row lock the pull's SKIP LOCKED steps
    // over, so a single pull is timing-dependent. See claimPick.
    await claimPick(h.baseUrl, staffAuth, shipment.id);
    const resv = await h.prisma.stockReservation.findFirstOrThrow({
      where: { orderId, status: 'ACTIVE', NOT: { binId: null } },
    });
    const items = await h.prisma.shipmentItem.findMany({
      where: { shipmentId: shipment.id },
      select: { id: true },
    });
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipment.id}/items`)
      .set(staffAuth)
      .send({
        shipmentItemId: items[0]!.id,
        pickedBinId: resv.binId,
        pickedBatchId: resv.batchId,
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipment.id}/complete`)
      .set(staffAuth)
      .expect(200);
    const pack = await request(h.baseUrl)
      .post(`/warehouse/packs/${shipment.id}/complete`)
      .set(staffAuth)
      .expect(200);

    await request(h.baseUrl)
      .post(`/admin/courier/manifests/${pack.body.manifestId}/confirm-handoff`)
      .set(staffAuth)
      .expect(409);
  });

  it('THE BENCH IS THE HANDOVER: one scan dispatches a PACKED parcel, no manifest touched', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, manifestId, awbNumber } = await driveToPacked(2);

    // Nobody closed anything. The manifest is DRAFT and the order is
    // PACKED — the state a warehouse is actually in when a van arrives.
    const before = await h.prisma.manifest.findUniqueOrThrow({ where: { id: manifestId } });
    expect(before.status).toBe(ManifestStatus.DRAFT);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.PACKED,
    );
    expect(await stockOf()).toEqual({ qtyOnHand: 8, qtyReserved: 0 });

    const res = await request(h.baseUrl)
      .post('/admin/courier/handover-scan')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(res.body).toMatchObject({
      shipmentId,
      orderId,
      alreadyScanned: false,
      dispatched: true,
      manifestDispatched: true,
    });

    // The parcel is with the courier, by one scan.
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      OrderStatus.DISPATCHED,
    );
    const ship = await h.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(ship.status).toBe(ShipmentStatus.HANDED_TO_COURIER);
    expect(ship.handoverScannedAt).not.toBeNull();
    expect(ship.pickedUpByCourierAt).not.toBeNull();

    // The manifest closed itself out — it is a record, not a step.
    const after = await h.prisma.manifest.findUniqueOrThrow({ where: { id: manifestId } });
    expect(after.status).toBe(ManifestStatus.DISPATCHED);
    expect(after.handoffConfirmedAt).not.toBeNull();

    // Stock-neutral: the decrement happened at pack (Model C).
    expect(await stockOf()).toEqual({ qtyOnHand: 8, qtyReserved: 0 });
    const packMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_CONFIRM },
    });
    expect(packMovements).toHaveLength(1);
  });

  it('a repeat scan is a no-op — not an error, and nothing moves twice', async () => {
    await receiveStock(10);
    const { orderId, awbNumber } = await driveToPacked(2);

    await request(h.baseUrl)
      .post('/admin/courier/handover-scan')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    const second = await request(h.baseUrl)
      .post('/admin/courier/handover-scan')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(second.body).toMatchObject({ alreadyScanned: true, dispatched: true });

    const events = await h.prisma.orderEvent.findMany({
      where: { orderId, toStatus: OrderStatus.DISPATCHED },
    });
    expect(events).toHaveLength(1);
    expect(await stockOf()).toEqual({ qtyOnHand: 8, qtyReserved: 0 });
  });

  it('refuses a parcel that has not been packed, and names where it actually is', async () => {
    await receiveStock(10);
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Too Early',
        recipientPhoneE164: '+919876500077',
        recipientAddressLine1: '12 MG Road',
        recipientAddressLine2: 'Near City Hospital',
        recipientCity: 'Bengaluru',
        recipientStateProvince: 'Karnataka',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        codAmountInr: 999,
        items: [{ variantId, quantity: 2 }],
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
    await settleAwb(h.prisma, shipment.id);
    const withAwb = await h.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });

    const res = await request(h.baseUrl)
      .post('/admin/courier/handover-scan')
      .set(staffAuth)
      .send({ awbNumber: withAwb.awbNumber })
      .expect(409);
    expect(res.body.code).toBe('NOT_READY_FOR_HANDOVER');
    expect(res.body.message).toContain('CONFIRMED');
  });
});
