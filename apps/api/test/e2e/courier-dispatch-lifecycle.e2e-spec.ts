import request from 'supertest';
import {
  ActorType,
  ManifestStatus,
  OrderStatus,
  ShipmentStatus,
  StockMovementType,
} from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  claimPick,
  settleAwb,
  type AppHarness,
} from './app-harness';

/**
 * Module 9 commit 16 — full courier dispatch lifecycle e2e.
 *
 *   1. Happy lifecycle to DELIVERED — AWB generated → handoff → DISPATCHED
 *      (Model-A qtyOnHand decrement) → IN_TRANSIT → OUT_FOR_DELIVERY →
 *      DELIVERED. Asserts DELIVERED is STOCK-NEUTRAL (the decrement
 *      already happened at dispatch; tracking transitions never touch
 *      stock).
 *   2. AWB partial failure isolation — two orders / two shipments in ONE
 *      manifest, one to a good pincode + one to a stub-failing pincode.
 *      The AWB job generates the good one and supersedes the failed one
 *      (manifest → CONFIRMED, ≥1 success); confirm-handoff dispatches the
 *      good order; the failed order is recovered via manual placement.
 *      Conservation holds across both.
 */
describe('Courier dispatch lifecycle (e2e)', () => {
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

    const email = `cdl-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'CDL Brand',
        contactPersonName: 'CDL Owner',
        phone: '+8801712345685',
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

  /** Create + CONFIRM an order (auto-provisions the shipment). */
  async function confirmOrder(
    postalCode: string,
    qty = 2,
  ): Promise<{ orderId: string; shipmentId: string }> {
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
        recipientPostalCode: postalCode,
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
    return { orderId, shipmentId: shipment.id };
  }

  /** Pick + pack one shipment; returns the DRAFT manifest it attached to. */
  async function pickAndPack(orderId: string, shipmentId: string): Promise<string> {
    // The AWB is generated at confirmation on a BullMQ job, and while it
    // runs it holds a row lock the pick's SKIP LOCKED pull would skip
    // past. Settle first — see settleAwb.
    await settleAwb(h.prisma, shipmentId);
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
    return pack.body.manifestId as string;
  }

  async function stockOf(): Promise<{ qtyOnHand: number; qtyReserved: number }> {
    const level = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    return { qtyOnHand: level.qtyOnHand, qtyReserved: level.qtyReserved };
  }

  it('full lifecycle to DELIVERED: AWB → handoff → DISPATCHED decrements, DELIVERED is stock-neutral', async () => {
    await receiveStock(10);
    const { orderId, shipmentId } = await confirmOrder('560001', 2);
    const manifestId = await pickAndPack(orderId, shipmentId);

    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${manifestId}/close`)
      .set(staffAuth)
      .expect(200);
    await waitFor(
      async () => {
        const m = await h.prisma.manifest.findUniqueOrThrow({
          where: { id: manifestId },
        });
        return m.status === ManifestStatus.CONFIRMED ? m : null;
      },
      { timeoutMs: 15_000, description: 'manifest CONFIRMED (AWB generated)' },
    );

    // confirm-handoff → DISPATCHED (Model-A decrement: 10 → 8).
    await request(h.baseUrl)
      .post(`/admin/courier/manifests/${manifestId}/confirm-handoff`)
      .set(staffAuth)
      .expect(200);
    expect(await stockOf()).toEqual({ qtyOnHand: 8, qtyReserved: 0 });

    // Tracking transitions to DELIVERED — all stock-neutral under Model A.
    const ow = h.app.get(OrderWriteService);
    for (const to of [
      OrderStatus.IN_TRANSIT,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
    ]) {
      await ow.transitionStatus({
        orderId,
        to,
        actor: { type: ActorType.STAFF, id: staffId },
      });
      // qtyOnHand stays 8 at every post-dispatch step.
      expect((await stockOf()).qtyOnHand).toBe(8);
    }

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERED);
    // Exactly one stock movement for the whole lifecycle — the DISPATCH.
    const movements = await h.prisma.stockMovement.findMany({
      where: { orderId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe(StockMovementType.DISPATCH);
    expect(movements[0]!.qtyChange).toBe(-2);
  });

  it('AWB partial failure isolation: one shipment generates, one supersedes — both orders recovered', async () => {
    await receiveStock(10);
    // Order A → good pincode; order B → stub-failing pincode. Both pack
    // into the SAME DRAFT manifest (one courier + one warehouse).
    const a = await confirmOrder('560001', 2);
    const b = await confirmOrder('999999', 2);
    const manifestId = await pickAndPack(a.orderId, a.shipmentId);
    const manifestB = await pickAndPack(b.orderId, b.shipmentId);
    expect(manifestB).toBe(manifestId); // WMS-7 find-or-create — same DRAFT

    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    // AWB job: A generates, B fails → supersede + order B → manual.
    // Manifest → CONFIRMED (≥1 success). The mid-loop supersede write
    // lands BEFORE the post-loop manifest update; wait on the LAST
    // step (manifest CONFIRMED) — that implicitly guarantees the
    // replacement is visible too, and mirrors the full-lifecycle
    // test's waitFor pattern. (Pre-M11 the gap was tight enough that
    // a replacement-only wait worked by accident; M11's per-emit
    // listener fan-out widened the window enough to expose the race.)
    await waitFor(
      async () => {
        const m = await h.prisma.manifest.findUniqueOrThrow({
          where: { id: manifestId },
        });
        return m.status === ManifestStatus.CONFIRMED ? m : null;
      },
      {
        timeoutMs: 15_000,
        description: 'manifest CONFIRMED (AWB job loop finished)',
      },
    );
    const replacementB = await h.prisma.shipment.findFirstOrThrow({
      where: { supersedesShipmentId: b.shipmentId },
    });

    const orderA = await h.prisma.order.findUniqueOrThrow({
      where: { id: a.orderId },
    });
    const orderB = await h.prisma.order.findUniqueOrThrow({
      where: { id: b.orderId },
    });
    expect(orderA.status).toBe(OrderStatus.PENDING_DISPATCH);
    expect(orderB.status).toBe(OrderStatus.PENDING_MANUAL_PLACEMENT);
    const shipA = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: a.shipmentId },
    });
    const shipB = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: b.shipmentId },
    });
    // The AWB does NOT advance the shipment's status — it is generated
    // at order confirmation now, and both warehouse queues select on
    // `status = 'created'`, so moving it here took the parcel out of
    // the pick and pack flow. `awbNumber` is the authoritative fact
    // (CUR-9); the status says where the parcel physically is.
    expect(shipA.status).toBe(ShipmentStatus.CREATED);
    expect(shipA.awbNumber).not.toBeNull();
    expect(shipB.status).toBe(ShipmentStatus.FAILED_AT_CREATION);

    // confirm-handoff: only order A is AWB-ready in the manifest.
    const handoff = await request(h.baseUrl)
      .post(`/admin/courier/manifests/${manifestId}/confirm-handoff`)
      .set(staffAuth)
      .expect(200);
    expect(handoff.body.transitionedCount).toBe(1);
    expect(handoff.body.dispatchedShipmentIds).toEqual([a.shipmentId]);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: a.orderId } })).status).toBe(
      OrderStatus.DISPATCHED,
    );
    expect(await stockOf()).toEqual({ qtyOnHand: 8, qtyReserved: 2 }); // A out

    // Recover order B via manual placement on its replacement shipment.
    await request(h.baseUrl)
      .post(`/admin/courier/manual-placement/shipments/${replacementB.id}/place-awb`)
      .set(staffAuth)
      .send({ awbNumber: 'MANUAL-CDL-001', courierName: 'DTDC' })
      .expect(200);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe(
      OrderStatus.DISPATCHED,
    );

    // Conservation: both orders dispatched — qtyOnHand 10 − 2 − 2 = 6.
    expect(await stockOf()).toEqual({ qtyOnHand: 6, qtyReserved: 0 });
    const active = await h.prisma.stockReservation.findMany({
      where: {
        orderId: { in: [a.orderId, b.orderId] },
        status: 'ACTIVE',
      },
    });
    expect(active).toHaveLength(0);
    const dispatchMovements = await h.prisma.stockMovement.findMany({
      where: {
        orderId: { in: [a.orderId, b.orderId] },
        type: StockMovementType.DISPATCH,
      },
    });
    expect(dispatchMovements).toHaveLength(2);
    // Order B's DISPATCH movement is keyed to the live replacement.
    const bMovement = dispatchMovements.find((m) => m.orderId === b.orderId);
    expect(bMovement!.shipmentId).toBe(replacementB.id);
  });
});
