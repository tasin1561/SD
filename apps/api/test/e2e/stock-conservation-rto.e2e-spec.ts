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
import { FLOOR_BIN_CODE } from '../../src/modules/inventory-warehouse/bin-code';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  claimPick,
  resetAuthState,
  waitFor,
  type AppHarness,
  packAtBench,
} from './app-harness';

/**
 * Stock conservation invariant across the FULL order lifecycle —
 * commit-17 pre-flight verification. Drives the order through the real
 * dispatch path (NOT manual AWB stamping) and asserts that
 * stock_levels.qtyOnHand + stock_levels.qtyReserved + active reservation
 * rows return to the expected baseline after both RESTOCK and WRITE_OFF
 * RTO finalize.
 *
 * Baseline: 10 on-hand, 0 reserved, no active reservations. Order qty=2.
 *
 * Expected post-RESTOCK: 10 on-hand, 0 reserved, 0 active reservations
 *   (the 2 units returned to the shelf; nothing leaked).
 * Expected post-WRITE_OFF: 8 on-hand, 0 reserved, 0 active reservations
 *   (the 2 units truly left the system; nothing leaked).
 */
describe('Stock conservation across RTO lifecycle (commit-17 invariant)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let sellerAuth: { Authorization: string };
  let warehouseId: string;
  let zoneId: string;
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

    const email = `cons-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Cons Brand',
        contactPersonName: 'Cons Owner',
        phone: '+8801712345682',
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
    zoneId = zone.body.id as string;
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

  interface Snapshot {
    qtyOnHand: number;
    qtyReserved: number;
    activeResvCount: number;
    activeResvTotalQty: number;
  }
  /** Summed over every bin: since WMS-8e a return comes back to a bin other
   *  than the one it left (the returns hold, then the floor). */
  async function snapshot(): Promise<Snapshot> {
    const levels = await h.prisma.stockLevel.findMany({ where: { variantId } });
    const active = await h.prisma.stockReservation.findMany({
      where: { status: ReservationStatus.ACTIVE, variantId },
    });
    return {
      qtyOnHand: levels.reduce((sum, l) => sum + l.qtyOnHand, 0),
      qtyReserved: levels.reduce((sum, l) => sum + l.qtyReserved, 0),
      activeResvCount: active.length,
      activeResvTotalQty: active.reduce((s, r) => s + r.qtyReserved, 0),
    };
  }

  /** Drive the order through the REAL dispatch path: pick → pack →
   *  manifest close → DISPATCHED → RTO_INITIATED → RTO_RECEIVED. No
   *  manual AWB stamping for receive (we set AWB only because M9 isn't
   *  built, but the order status path is real). */
  async function driveToRtoReceived(qty: number): Promise<{
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
    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    // commit-16 auto-provisions the shipment on CONFIRMED.
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });
    const shipmentId = shipment.id;

    // Real pick path (HTTP).
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

    // Real pack path (HTTP).
    const pack = await packAtBench(h.baseUrl, staffAuth, h.prisma, shipmentId);
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${pack.body.manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    // M9 commit 10: close enqueues the AWB job; the in-process worker
    // generates the AWB (stub-mode Delhivery — the REAL AWB-generation
    // path, no manual stamping).
    const withAwb = await waitFor(
      async () => {
        const s = await h.prisma.shipment.findUniqueOrThrow({
          where: { id: shipmentId },
        });
        return s.awbNumber !== null ? s : null;
      },
      { timeoutMs: 15_000, description: 'AWB generated for the shipment' },
    );
    const awbNumber = withAwb.awbNumber as string;

    // DISPATCHED via OrderWriteService — real saga transitions.
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

    // RTO receive via real HTTP.
    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    return {
      orderId,
      shipmentId,
      shipmentItemIds: items.map((i) => i.id),
      awbNumber,
    };
  }

  it('LIFECYCLE TRACE: baseline 10/0 → CONFIRMED → PICKED → PACKED → DISPATCHED → RTO_RECEIVED', async () => {
    await receiveStock(10);
    const baseline = await snapshot();
    expect(baseline).toEqual({
      qtyOnHand: 10,
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });

    const ow = h.app.get(OrderWriteService);

    // Step 1: create + submit + CONFIRMED → phase-1 reservation.
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Asha',
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
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const afterConfirmed = await snapshot();
    // CONFIRMED: phase-1 reservation (NULL bin) — does NOT touch
    // stock_levels.qtyReserved (INV-4: counts phase-2 only).
    expect(afterConfirmed).toMatchObject({
      qtyOnHand: 10,
      qtyReserved: 0,
      activeResvCount: 1,
      activeResvTotalQty: 2,
    });

    // Step 2: pick.start → phase-2 allocation (bin/batch set,
    // stock_levels.qtyReserved += 2).
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });
    // Pull until THIS parcel comes back: the AWB job (fired at
    // confirmation) holds a row lock the pull's SKIP LOCKED steps
    // over, so a single pull is timing-dependent. See claimPick.
    await claimPick(h.baseUrl, staffAuth, shipment.id);
    const afterPickStart = await snapshot();
    expect(afterPickStart).toMatchObject({
      qtyOnHand: 10, // physical inventory not yet decremented
      qtyReserved: 2, // phase-2 hold appeared on stock_levels
      activeResvCount: 1,
      activeResvTotalQty: 2,
    });

    // Step 3: pick.recordItem + pick.complete → order PICKED.
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
    const afterPickComplete = await snapshot();
    // PICKED: PickExecutionService.complete in commit 6 issues NO
    // StockMutationService PICK movement (the matrix edge PENDING_PICK
    // → PICKED has empty side-effects). The "physical pick movement is
    // Module 8's" promise from StockReservationService.fulfill JSDoc
    // is UNFULFILLED in commit 6.
    expect(afterPickComplete).toMatchObject({
      qtyOnHand: 10, // STILL 10 — no pick decrement happened
      qtyReserved: 2,
      activeResvCount: 1,
      activeResvTotalQty: 2,
    });

    // Step 4: pack.complete → PACKED — THE MODEL C DECREMENT
    // (2026-09-03): the DISPATCH_STOCK side-effect now lives on
    // PICKED → PACKED. It issues a PACK_CONFIRM movement (−2) AND
    // fulfill()s the phase-2 reservation right here — the goods are
    // counted gone the moment the box is sealed, not whenever a
    // courier eventually collects it.
    const pack = await packAtBench(h.baseUrl, staffAuth, h.prisma, shipment.id);
    const afterPack = await snapshot();
    expect(afterPack).toEqual({
      qtyOnHand: 8, // decremented at pack
      qtyReserved: 0, // phase-2 hold given back by fulfill()
      activeResvCount: 0, // reservation FULFILLED
      activeResvTotalQty: 0,
    });

    // Step 5: manifest close → PENDING_DISPATCH + (M9 commit 10) the AWB
    // job is enqueued. The AWB job touches NO stock (it sets awbNumber +
    // shipment status only) — the snapshot is unaffected.
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${pack.body.manifestId}/close`)
      .set(staffAuth)
      .expect(200);
    const afterClose = await snapshot();
    expect(afterClose).toEqual({
      qtyOnHand: 8,
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });

    // Wait for the AWB job (stub-mode Delhivery) to stamp the awbNumber.
    const withAwb = await waitFor(
      async () => {
        const s = await h.prisma.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
        });
        return s.awbNumber !== null ? s : null;
      },
      { timeoutMs: 15_000, description: 'AWB generated' },
    );

    // Step 6: DISPATCHED — STOCK-NEUTRAL under Model C. The decrement
    // + fulfill already happened at PACKED (step 4); this transition
    // just records that a courier physically took the parcel.
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.DISPATCHED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const afterDispatch = await snapshot();
    expect(afterDispatch).toEqual({
      qtyOnHand: 8, // unchanged — already decremented at pack
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });

    // Step 7: DISPATCHED → RTO_INITIATED → RTO_RECEIVED — stock-neutral.
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.RTO_INITIATED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber: withAwb.awbNumber })
      .expect(200);
    const afterRtoReceived = await snapshot();
    expect(afterRtoReceived).toEqual({
      qtyOnHand: 8, // unchanged — no returns hold bin here, so receive books nothing (WMS-8e)
      qtyReserved: 0,
      activeResvCount: 0, // reservation was FULFILLED at dispatch
      activeResvTotalQty: 0,
    });
  });

  it('CONSERVATION RESTOCK: full lifecycle through all-RESTOCK finalize → expect baseline (10/0) restored', async () => {
    await receiveStock(10);
    const baseline = await snapshot();
    expect(baseline.qtyOnHand).toBe(10);
    expect(baseline.qtyReserved).toBe(0);

    const { shipmentId, shipmentItemIds } = await driveToRtoReceived(2);

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

    const final = await snapshot();

    // CONSERVATION CHECK: baseline 10/0 → after RESTOCK → expect 10/0/0/0.
    expect(final).toEqual({
      qtyOnHand: 10,
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });

    // INV-3 availability sanity: qtyOnHand - qtyReserved - active phase-1 = 10.
    const availability = final.qtyOnHand - final.qtyReserved;
    expect(availability).toBe(10);
  });

  it('CONSERVATION WRITE_OFF: full lifecycle through all-WRITE_OFF finalize → expect on-hand=8 (2 units left the system), 0 reserved, 0 active', async () => {
    await receiveStock(10);
    const { shipmentId, shipmentItemIds } = await driveToRtoReceived(2);

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

    const final = await snapshot();
    // CONSERVATION CHECK: 2 units physically left the system; on-hand
    // should be 8; no reserved; no active reservations.
    expect(final).toEqual({
      qtyOnHand: 8,
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });
  });

  // ── WMS-8e: booked into the returns hold at RECEIVE, moved at FINALIZE ──

  /** A bin of the given type in zone A (codes are composed, never typed). */
  async function createBin(aisle: string, type: 'RTO_HOLD' | 'DAMAGED'): Promise<string> {
    const res = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId, aisle, rack: '1', shelf: '1', type })
      .expect(201);
    return res.body.id as string;
  }

  /** On-hand for the variant in one bin, across batches. */
  async function onHandIn(bin: string): Promise<number> {
    const rows = await h.prisma.stockLevel.findMany({ where: { variantId, binId: bin } });
    return rows.reduce((s, r) => s + r.qtyOnHand, 0);
  }

  /** On-hand a picker can reach (BIN-2): never the returns hold or the damaged bin. */
  async function sellableOnHand(): Promise<number> {
    const levels = await h.prisma.stockLevel.findMany({
      where: { variantId },
      include: { bin: { select: { type: true } } },
    });
    return levels
      .filter((l) => l.bin.type !== 'RTO_HOLD' && l.bin.type !== 'DAMAGED')
      .reduce((s, l) => s + l.qtyOnHand, 0);
  }

  /** Receive stock with no bin named: bin tracking is off, so it lands on
   *  the warehouse's FLOOR bin (BIN-1). Returns that bin. */
  async function receiveStockOnFloor(qty: number): Promise<string> {
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
      .send({ lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty }] })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
    const floor = await h.prisma.warehouseBin.findFirstOrThrow({
      where: { warehouseId, code: FLOOR_BIN_CODE, deletedAt: null },
    });
    return floor.id;
  }

  it('WMS-8e TRACE: qty-10 SKU, 2 returned, 1 RESTOCK + 1 HOLD_DAMAGED → packed floor 8 / received floor 8 + hold 2 / finalized floor 9 + damaged 1', async () => {
    const floorBinId = await receiveStockOnFloor(10);
    const holdBinId = await createBin('R', 'RTO_HOLD');
    const damagedBinId = await createBin('D', 'DAMAGED');
    const { orderId, shipmentId, shipmentItemIds } = await driveToRtoReceived(2);
    expect(shipmentItemIds).toHaveLength(1); // ONE line of quantity 2
    const itemId = shipmentItemIds[0] as string;

    // RECEIVED: the 2 packed off the floor are back in the building, booked
    // into the returns hold — on hand (10), not sellable (8).
    expect(await onHandIn(floorBinId)).toBe(8);
    expect(await onHandIn(holdBinId)).toBe(2);
    expect(await sellableOnHand()).toBe(8);
    expect((await snapshot()).qtyOnHand).toBe(10);
    const booking = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RECEIVE },
    });
    expect(booking.map((m) => [m.binId, m.qtyChange])).toEqual([[holdBinId, 2]]);

    await request(h.baseUrl)
      .post(`/warehouse/rto/items/${itemId}/inspect`)
      .set(staffAuth)
      .send({
        rows: [
          { quantity: 1, condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK },
          {
            quantity: 1,
            condition: RtoItemCondition.DAMAGED,
            disposition: RtoDisposition.HOLD_DAMAGED,
            notes: 'cracked casing',
          },
        ],
      })
      .expect(200);

    // Two rows stored; the line keeps a meaningful summary.
    const rows = await h.prisma.shipmentItemRtoInspection.findMany({
      where: { shipmentItemId: itemId },
      orderBy: { position: 'asc' },
    });
    expect(rows.map((r) => [r.quantity, r.condition, r.disposition])).toEqual([
      [1, RtoItemCondition.GOOD, RtoDisposition.RESTOCK],
      [1, RtoItemCondition.DAMAGED, RtoDisposition.HOLD_DAMAGED],
    ]);

    // ONE scrap ticket for the line, saying which unit and what happens.
    const ticket = await h.prisma.ticket.findFirstOrThrow({
      where: { shipmentItemId: itemId },
    });
    expect(ticket.description).toContain('1 of 2 arrived damaged');
    expect(ticket.description).toContain('1 of 2 is in good condition');

    // Decided, not finalized: still in the hold, still not sellable.
    expect(await onHandIn(holdBinId)).toBe(2);
    expect(await sellableOnHand()).toBe(8);

    const fin = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);
    expect(fin.body).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      restockedUnits: 1,
      heldDamagedUnits: 1,
      writtenOffUnits: 0,
      alreadyFinalized: false,
    });

    // FINALIZED: floor 9, hold 0, damaged 1 — 10 on hand, 9 sellable.
    expect(await onHandIn(floorBinId)).toBe(9);
    expect(await onHandIn(holdBinId)).toBe(0);
    expect(await onHandIn(damagedBinId)).toBe(1);
    expect(await sellableOnHand()).toBe(9);
    expect(await snapshot()).toEqual({
      qtyOnHand: 10,
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });

    // MOVED, never re-created: no RETURN_RESTOCK — two paired transfers out
    // of the hold, one to the floor and one to the damaged bin.
    expect(
      await h.prisma.stockMovement.count({
        where: { orderId, type: StockMovementType.RETURN_RESTOCK },
      }),
    ).toBe(0);
    const outs = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.TRANSFER_OUT },
    });
    expect(outs.map((m) => [m.binId, m.qtyChange])).toEqual([
      [holdBinId, -1],
      [holdBinId, -1],
    ]);
    const ins = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.TRANSFER_IN },
    });
    expect(ins.map((m) => [m.binId, m.qtyChange]).sort()).toEqual(
      [
        [floorBinId, 1],
        [damagedBinId, 1],
      ].sort(),
    );

    // Nothing to shelve: the restocked unit is already sellable.
    const pending = await request(h.baseUrl)
      .get(`/warehouse/rto/shipments/${shipmentId}/putaway`)
      .set(staffAuth)
      .expect(200);
    expect(pending.body).toEqual([]);

    // Gate 1: a re-finalize moves nothing.
    const again = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);
    expect(again.body.alreadyFinalized).toBe(true);
    expect(
      await h.prisma.stockMovement.count({
        where: { orderId, type: StockMovementType.TRANSFER_OUT },
      }),
    ).toBe(2);
  });

  it('WMS-8e WRITE_OFF: booked into the hold at receive, taken out by an adjustment — hold 0, on hand 8', async () => {
    await receiveStock(10);
    const holdBinId = await createBin('R', 'RTO_HOLD');
    const { orderId, shipmentId, shipmentItemIds } = await driveToRtoReceived(2);
    expect(await onHandIn(holdBinId)).toBe(2);
    expect((await snapshot()).qtyOnHand).toBe(10);

    await request(h.baseUrl)
      .post(`/warehouse/rto/items/${shipmentItemIds[0] as string}/inspect`)
      .set(staffAuth)
      .send({ condition: RtoItemCondition.DAMAGED, disposition: RtoDisposition.WRITE_OFF })
      .expect(200);
    const fin = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);
    expect(fin.body).toMatchObject({ status: OrderStatus.RTO_DAMAGED, writtenOffUnits: 2 });

    expect(await onHandIn(holdBinId)).toBe(0);
    expect(await snapshot()).toEqual({
      qtyOnHand: 8,
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });
    const adjustments = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.ADJUSTMENT_DECREASE },
    });
    expect(adjustments.map((m) => [m.binId, m.qtyChange, m.reasonCode])).toEqual([
      [holdBinId, -2, StockMovementReasonCode.DAMAGED_IN_WAREHOUSE],
    ]);
  });

  it('WMS-8e LEGACY: a return received with no hold booking finalizes straight to a sellable bin, never the hold', async () => {
    await receiveStock(10);
    // No returns hold bin at receive: recorded, nothing booked, and said so.
    const { orderId, shipmentId, shipmentItemIds } = await driveToRtoReceived(2);
    expect(
      await h.prisma.stockMovement.count({
        where: { shipmentId, type: StockMovementType.RETURN_RECEIVE },
      }),
    ).toBe(0);
    const issue = await h.prisma.systemIssue.findFirst({
      where: { dedupeKey: `rto-hold-bin-missing:${warehouseId}`, resolvedAt: null },
    });
    expect(issue).not.toBeNull();

    // The hold exists by finalize — exactly the shape of a return received
    // before WMS-8e (production's SD-2026-26-000009 / SH-TEST-523902).
    const holdBinId = await createBin('R', 'RTO_HOLD');
    await request(h.baseUrl)
      .post(`/warehouse/rto/items/${shipmentItemIds[0] as string}/inspect`)
      .set(staffAuth)
      .send({ condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK })
      .expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);

    const floor = await h.prisma.warehouseBin.findFirstOrThrow({
      where: { warehouseId, code: FLOOR_BIN_CODE, deletedAt: null },
    });
    const restocks = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(restocks.map((m) => [m.binId, m.qtyChange])).toEqual([[floor.id, 2]]);
    expect(await onHandIn(holdBinId)).toBe(0);
    expect((await snapshot()).qtyOnHand).toBe(10);
    expect(await sellableOnHand()).toBe(10);
  });

  it('WMS-8e NEVER LEFT: a parcel that never left stock through Skydrop books nothing, and a restock is refused as before', async () => {
    await receiveStock(10);
    const holdBinId = await createBin('R', 'RTO_HOLD');
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
    const shipment = await waitFor(
      async () => {
        const s = await h.prisma.shipment.findFirst({
          where: { orderShipments: { some: { orderId } }, awbNumber: { not: null } },
        });
        return s ?? null;
      },
      { timeoutMs: 15_000, description: 'AWB generated for the never-packed shipment' },
    );
    // The seeded shape (SH-TEST-*): straight to RTO with no pick and no
    // pack, so nothing ever left stock. A direct test write, as the seed
    // script's was — there is no lifecycle path to this state.
    await h.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.RTO_INITIATED },
    });

    const rec = await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber: shipment.awbNumber })
      .expect(200);
    expect(rec.body.holdBooking).toMatchObject({ outcome: 'NOTHING_TO_BOOK', unitsBooked: 0 });
    expect(await onHandIn(holdBinId)).toBe(0);
    expect(
      await h.prisma.stockMovement.count({
        where: { shipmentId: shipment.id, type: StockMovementType.RETURN_RECEIVE },
      }),
    ).toBe(0);

    const items = await h.prisma.shipmentItem.findMany({ where: { shipmentId: shipment.id } });
    await request(h.baseUrl)
      .post(`/warehouse/rto/items/${items[0]!.id}/inspect`)
      .set(staffAuth)
      .send({ condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK })
      .expect(200);
    const r = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipment.id}/finalize`)
      .set(staffAuth)
      .expect(409);
    expect(r.body.code).toBe('RTO_RESTOCK_NEVER_LEFT_STOCK');
    expect((await snapshot()).qtyOnHand).toBe(10);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_RECEIVED);
  });

  it('WMS-8d/8e: Keep aside (damaged) with no DAMAGED bin is refused by name, and nothing leaves the hold', async () => {
    await receiveStock(10);
    const holdBinId = await createBin('R', 'RTO_HOLD');
    const { orderId, shipmentId, shipmentItemIds } = await driveToRtoReceived(2);
    await request(h.baseUrl)
      .post(`/warehouse/rto/items/${shipmentItemIds[0] as string}/inspect`)
      .set(staffAuth)
      .send({ condition: RtoItemCondition.DAMAGED, disposition: RtoDisposition.HOLD_DAMAGED })
      .expect(200);
    const r = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(409);
    expect(r.body.code).toBe('RTO_NO_DAMAGED_BIN');
    expect(await onHandIn(binId)).toBe(8);
    expect(await onHandIn(holdBinId)).toBe(2);
    expect(
      await h.prisma.stockMovement.count({
        where: {
          orderId,
          type: { in: [StockMovementType.RETURN_RESTOCK, StockMovementType.TRANSFER_OUT] },
        },
      }),
    ).toBe(0);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_RECEIVED);
  });

  it('MODEL C GIVE-BACK: admin-cancelling an already-packed order reverses the PACK_CONFIRM decrement — 10/0 restored', async () => {
    await receiveStock(10);
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Give Back',
        recipientPhoneE164: '+919876500001',
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
    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });
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
    await packAtBench(h.baseUrl, staffAuth, h.prisma, shipment.id);

    // The box is sealed: qtyOnHand already moved.
    const afterPack = await snapshot();
    expect(afterPack).toEqual({
      qtyOnHand: 8,
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });

    // Admin calls it off before any courier saw it (PACKED →
    // CANCELLED_BY_ADMIN carries UNPACK_STOCK under Model C).
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.CANCELLED_BY_ADMIN,
      actor: { type: ActorType.STAFF, id: staffId },
      reason: 'Admin cancel of a packed-but-not-dispatched parcel',
    });

    const afterCancel = await snapshot();
    expect(afterCancel).toEqual({
      qtyOnHand: 10, // the PACK_CONFIRM decrement was reversed
      qtyReserved: 0,
      activeResvCount: 0,
      activeResvTotalQty: 0,
    });

    // The give-back is a NEW movement, not an erased one — the ledger
    // stays append-only and both facts remain visible in stock_movements.
    const packMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_CONFIRM },
    });
    expect(packMovements).toHaveLength(1);
    expect(packMovements[0]!.qtyChange).toBe(-2);
    const reversedMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_REVERSED },
    });
    expect(reversedMovements).toHaveLength(1);
    expect(reversedMovements[0]!.qtyChange).toBe(2);
    expect(
      (reversedMovements[0]!.metadata as { reversesMovementId?: string } | null)
        ?.reversesMovementId,
    ).toBe(packMovements[0]!.id);

    // The order-level NOOP_TRANSITION guard is the outer idempotency net:
    // CANCELLED_BY_ADMIN → CANCELLED_BY_ADMIN is not a declared matrix
    // self-loop, so a literal repeat call is refused here, before it
    // could ever reach the movement-reversal logic. Per-movement
    // idempotency inside transitionWithUnpack itself (the crash-recovery
    // case, where a retry re-enters from PACKED before the order's
    // status update ever committed) is covered directly in
    // order-write.service.spec.ts, which can simulate that window.
    await expect(
      ow.transitionStatus({
        orderId,
        to: OrderStatus.CANCELLED_BY_ADMIN,
        actor: { type: ActorType.STAFF, id: staffId },
        reason: 'retry',
      }),
    ).rejects.toMatchObject({ response: { code: 'NOOP_TRANSITION' } });
    const reversedAgain = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_REVERSED },
    });
    expect(reversedAgain).toHaveLength(1); // still just the one
    expect(await snapshot()).toEqual(afterCancel);
  });

  it('MODEL C (2026-09-03): the PACK_CONFIRM movement fires at pack — qtyOnHand decremented exactly once, before dispatch', async () => {
    // The decrement moved off PENDING_DISPATCH → DISPATCHED and onto
    // PICKED → PACKED: that edge carries DISPATCH_STOCK, which issues a
    // PACK_CONFIRM StockMovement (−qty) + fulfill()s the reservation.
    // This is the break-on-regression guard for that move.
    await receiveStock(10);
    const { orderId } = await driveToRtoReceived(2);
    const packMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.PACK_CONFIRM },
    });
    expect(packMovements).toHaveLength(1);
    expect(packMovements[0]!.qtyChange).toBe(-2); // the ONE decrement
    expect(packMovements[0]!.shipmentId).not.toBeNull(); // shipment-grained

    // And no DISPATCH-type movement is ever issued any more — dispatch
    // is stock-neutral under Model C.
    const dispatchMovements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.DISPATCH },
    });
    expect(dispatchMovements).toHaveLength(0);
  });
});
