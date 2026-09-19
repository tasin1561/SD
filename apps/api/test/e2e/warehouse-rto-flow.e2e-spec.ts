import request from 'supertest';
import {
  ActorType,
  OrderStatus,
  ReservationStatus,
  RtoDisposition,
  RtoItemCondition,
  StockMovementType,
} from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { StockAvailabilityService } from '../../src/modules/inventory-shared/stock-availability.service';
import { FLOOR_BIN_CODE } from '../../src/modules/inventory-warehouse/bin-code';
import { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';
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
 * Module 8 warehouse-rto HTTP surface (M9 commit 12 bug-1 fix; Model C,
 * 2026-09-03, moved WHEN the decrement fires without touching this
 * pipeline at all). Drives the FULL CONFIRMED → pick → pack →
 * DISPATCHED → RTO_INITIATED → receive → inspect → finalize pipeline.
 *
 * qtyOnHand decrements at PACK (the one normal-lifecycle decrement,
 * PACK_CONFIRM movement); the phase-2 reservation is FULFILLED there.
 * finalize() does not care which matrix edge fired it — by the time an
 * order reaches RTO_RECEIVED it has necessarily happened — so finalize:
 *   - RESTOCK : RETURN_RESTOCK +qty re-add — qtyOnHand returns to
 *               baseline. No reservation release (already FULFILLED).
 *   - WRITE_OFF: NO movement — the original decrement stands; the unit
 *               is gone.
 */
describe('Warehouse RTO flow (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let sellerAuth: { Authorization: string };
  let sellerId: string;
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
    sellerId = reg.body.seller.id as string;

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
    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    // commit-16 auto-provisions; redundant call is idempotent.
    await h.app.get(ShipmentProvisionService).provisionFromSnapshot({
      orderId,
      // Resolved per seller by the post-commit hook in production (SET-1);
      // this suite calls the primitive directly, with the seeded default.
      courierCode: 'delhivery',
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

    const pack = await packAtBench(h.baseUrl, staffAuth, h.prisma, shipmentId);
    await request(h.baseUrl)
      .post(`/admin/warehouse/manifests/${pack.body.manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    // M9 commit 10: close enqueues the AWB job; the in-process worker
    // generates the AWB (stub-mode Delhivery). Wait for it to land — the
    // job stamps the real awbNumber (no manual stamping needed).
    const withAwb = await waitFor(
      async () => {
        const s = await h.prisma.shipment.findUniqueOrThrow({
          where: { id: shipmentId },
        });
        return s.awbNumber !== null ? s : null;
      },
      { timeoutMs: 15_000, description: 'AWB generated for the shipment' },
    );

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

    return {
      orderId,
      shipmentId,
      shipmentItemIds: items.map((i) => i.id),
      awbNumber: withAwb.awbNumber as string,
    };
  }

  it('a returned parcel costs delivery + RTO (200 + 30), charged when it is RECEIVED', async () => {
    await receiveStock(10);
    const { orderId, shipmentItemIds, awbNumber } = await makeRtoInitiatedShipment(2);

    // The order priced at the flat delivery fee — no zone, no weight
    // slab, no COD fee. 110001 and a 1kg parcel would have been ₹150.10
    // under the old engine; it is the same ₹200 as everywhere else now.
    const charges = await h.prisma.orderCharge.findMany({
      where: { orderId, deletedAt: null },
      orderBy: { displayOrder: 'asc' },
    });
    const shipping = charges.find((c) => c.type === 'BASE_SHIPPING');
    expect(shipping?.amountInr.toFixed(2)).toBe('200.00');
    // GST is seeded at 0 on the flat fees, and the line is written
    // anyway so the invoice can read it.
    const gst = charges.find((c) => c.type === 'GST');
    expect(gst?.amountInr.toFixed(2)).toBe('0.00');

    const before = await h.prisma.sellerWalletEntry.findMany({ where: { linkedOrderId: orderId } });
    expect(before.filter((e) => e.direction === 'RTO_FEE')).toHaveLength(0);

    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    // RECEIVE is the moment. A courier scan saying a parcel is coming
    // back is not the parcel coming back.
    const after = await h.prisma.sellerWalletEntry.findMany({ where: { linkedOrderId: orderId } });
    const rtoFee = after.filter((e) => e.direction === 'RTO_FEE');
    expect(rtoFee).toHaveLength(1);
    expect(rtoFee[0]!.amount.toFixed(2)).toBe('30.00');

    // The delivery fee is charged too, even though this order never
    // reached DELIVERED. The courier carried it out; that leg is owed.
    const orderCharges = after.filter((e) => e.direction === 'ORDER_CHARGES');
    expect(orderCharges).toHaveLength(1);
    expect(orderCharges[0]!.amount.toFixed(2)).toBe('200.00');

    // 200 + 30 = 230, and the RTO fee is NOT swept into ORDER_CHARGES —
    // that would charge it twice, invisibly, inside someone else's total.
    const total = after
      .filter((e) => e.direction === 'ORDER_CHARGES' || e.direction === 'RTO_FEE')
      .reduce((n, e) => n + Number(e.amount), 0);
    expect(total).toBe(230);

    // The seller can see WHY: a charge line accompanies the debit.
    const rtoLine = await h.prisma.orderCharge.findFirst({
      where: { orderId, type: 'RTO_FEE', deletedAt: null },
    });
    expect(rtoLine?.amountInr.toFixed(2)).toBe('30.00');
    expect(rtoLine?.isVisibleToSeller).toBe(true);

    // Re-receiving is idempotent on the money as well as the status.
    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    const afterRetry = await h.prisma.sellerWalletEntry.findMany({
      where: { linkedOrderId: orderId },
    });
    expect(afterRetry.filter((e) => e.direction === 'RTO_FEE')).toHaveLength(1);
    expect(afterRetry.filter((e) => e.direction === 'ORDER_CHARGES')).toHaveLength(1);

    void shipmentItemIds;
  });

  it("a seller's own rate wins over the global default", async () => {
    // The setting exists globally so there is always an answer; the
    // per-seller override exists because the rate is what was agreed
    // with that seller, and that is the one that counts.
    await request(h.baseUrl)
      .patch(`/admin/sellers/${sellerId}/settings/pricing.flat_delivery_fee`)
      .set(staffAuth)
      .send({ valueType: 'DECIMAL', value: '149.50', note: 'Negotiated launch rate' })
      .expect(200);
    await request(h.baseUrl)
      .patch(`/admin/sellers/${sellerId}/settings/pricing.flat_rto_fee`)
      .set(staffAuth)
      .send({ valueType: 'DECIMAL', value: '25.00', note: 'Negotiated launch rate' })
      .expect(200);

    await receiveStock(10);
    const { orderId, awbNumber } = await makeRtoInitiatedShipment(2);

    const shipping = await h.prisma.orderCharge.findFirst({
      where: { orderId, type: 'BASE_SHIPPING', deletedAt: null },
    });
    expect(shipping?.amountInr.toFixed(2)).toBe('149.50');

    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    const entries = await h.prisma.sellerWalletEntry.findMany({
      where: { linkedOrderId: orderId },
    });
    const rto = entries.find((e) => e.direction === 'RTO_FEE');
    expect(rto?.amount.toFixed(2)).toBe('25.00');
    const total = entries
      .filter((e) => e.direction === 'ORDER_CHARGES' || e.direction === 'RTO_FEE')
      .reduce((n, e) => n + Number(e.amount), 0);
    expect(total).toBe(174.5);
  });

  /** The warehouse's returns hold (R-01-01 in its own zone). */
  async function createHoldBin(): Promise<string> {
    const holdZone = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/zones`)
      .set(staffAuth)
      .send({ code: 'RET', name: 'Returns' })
      .expect(201);
    const holdBin = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId: holdZone.body.id, aisle: 'R', rack: '1', shelf: '1', type: 'RTO_HOLD' })
      .expect(201);
    // Composed server-side from the grid, never taken from the client.
    expect(holdBin.body.code).toBe('R-01-01');
    return holdBin.body.id as string;
  }

  it('WMS-8e: receive books the return into the hold — unsellable while undecided, sellable the moment it is finalised', async () => {
    // The owner: "R-01-01 should hold products that are received but not
    // decided yet … Put back in stock goes to floor."
    //
    // The INV-3 fix is still pinned here: availability used to count hold
    // stock, so the seller saw 10, an order confirmed against it, and pick
    // allocation then refused the bin and shortfalled on the floor.
    const holdBinId = await createHoldBin();
    await receiveStock(10);
    const { shipmentId, shipmentItemIds, awbNumber } = await makeRtoInitiatedShipment(2);

    const avail = async (): Promise<number> =>
      h.app.get(StockAvailabilityService).compute({ sellerId, variantId, warehouseId });

    expect(await avail()).toBe(8); // dispatched 2 of 10

    const rec = await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(rec.body.holdBooking).toMatchObject({ outcome: 'BOOKED', unitsBooked: 2 });

    // The units are back on the ledger, in the hold where they physically
    // are — and NOT for sale.
    const held = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId: holdBinId },
    });
    expect(held.qtyOnHand).toBe(2);
    expect(await avail()).toBe(8);

    for (const itemId of shipmentItemIds) {
      await request(h.baseUrl)
        .post(`/warehouse/rto/items/${itemId}/inspect`)
        .set(staffAuth)
        .send({ condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK })
        .expect(200);
    }
    // Decided but not finalised: putaway never offers an undecided return.
    const undecided = await request(h.baseUrl)
      .get(`/warehouse/rto/shipments/${shipmentId}/putaway`)
      .set(staffAuth)
      .expect(200);
    expect(undecided.body).toEqual([]);
    expect(await avail()).toBe(8);

    await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
      .set(staffAuth)
      .expect(200);

    // Out of the hold, onto the FLOOR (bin tracking is off), sellable now.
    const holdAfter = await h.prisma.stockLevel.findFirst({
      where: { variantId, binId: holdBinId },
    });
    expect(holdAfter?.qtyOnHand ?? 0).toBe(0);
    const floor = await h.prisma.warehouseBin.findFirstOrThrow({
      where: { warehouseId, code: FLOOR_BIN_CODE, deletedAt: null },
    });
    const floorLevel = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId: floor.id },
    });
    expect(floorLevel.qtyOnHand).toBe(2);
    expect(await avail()).toBe(10);

    // Nothing to shelve, and nothing can be shelved for it.
    const after = await request(h.baseUrl)
      .get(`/warehouse/rto/shipments/${shipmentId}/putaway`)
      .set(staffAuth)
      .expect(200);
    expect(after.body).toHaveLength(0);
    const refused = await request(h.baseUrl)
      .post(`/warehouse/rto/shipments/${shipmentId}/putaway`)
      .set(staffAuth)
      .send({ lines: [{ shipmentItemId: shipmentItemIds[0], destBinId: binId }] })
      .expect(409);
    expect(refused.body.code).toBe('RTO_PUTAWAY_NOT_IN_HOLD');
  });

  it('WMS-8e: with bin tracking ON, a booked restock goes back to the shelf it was picked from', async () => {
    const holdBinId = await createHoldBin();
    await receiveStock(10);
    const { shipmentId, shipmentItemIds, awbNumber } = await makeRtoInitiatedShipment(2);
    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    for (const itemId of shipmentItemIds) {
      await request(h.baseUrl)
        .post(`/warehouse/rto/items/${itemId}/inspect`)
        .set(staffAuth)
        .send({ condition: RtoItemCondition.GOOD, disposition: RtoDisposition.RESTOCK })
        .expect(200);
    }

    // Tracking is switched on only around the finalize — it is the one
    // step that reads it here — and put back whatever happens, because the
    // seeded warehouse outlives this test.
    const before = await h.prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseId } });
    await h.prisma.warehouse.update({
      where: { id: warehouseId },
      data: { binTrackingEnabled: true },
    });
    try {
      await request(h.baseUrl)
        .post(`/warehouse/rto/shipments/${shipmentId}/finalize`)
        .set(staffAuth)
        .expect(200);
    } finally {
      await h.prisma.warehouse.update({
        where: { id: warehouseId },
        data: { binTrackingEnabled: before.binTrackingEnabled },
      });
    }

    const shelf = await h.prisma.stockLevel.findFirstOrThrow({ where: { variantId, binId } });
    expect(shelf.qtyOnHand).toBe(10);
    const holdAfter = await h.prisma.stockLevel.findFirst({
      where: { variantId, binId: holdBinId },
    });
    expect(holdAfter?.qtyOnHand ?? 0).toBe(0);
    const ins = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.TRANSFER_IN },
    });
    expect(ins.map((m) => [m.binId, m.qtyChange])).toEqual([[binId, 2]]);
  });

  it('RESTOCK happy: RETURN_RESTOCK +qty re-adds — qtyOnHand 8 → 10', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, shipmentItemIds, awbNumber } = await makeRtoInitiatedShipment(2);

    // Model C: the PACK_CONFIRM decrement already fired at pack — qtyOnHand
    // 8, the phase-2 reservation FULFILLED (qtyReserved 0).
    const beforeFinalize = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(beforeFinalize.qtyOnHand).toBe(8);
    expect(beforeFinalize.qtyReserved).toBe(0);

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
    });

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_RESTOCKED);

    // WMS-8e: no returns hold bin here, so receive booked nothing and the
    // restock went straight to a sellable bin — the FLOOR (bin tracking is
    // off), not the shelf the stock was received onto.
    const floor = await h.prisma.warehouseBin.findFirstOrThrow({
      where: { warehouseId, code: FLOOR_BIN_CODE, deletedAt: null },
    });
    const shelfAfter = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(shelfAfter.qtyOnHand).toBe(8);
    const floorAfter = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId: floor.id },
    });
    expect(floorAfter.qtyOnHand).toBe(2); // RETURN_RESTOCK +2 — back to baseline 10 in total
    expect(floorAfter.qtyReserved).toBe(0);
    expect(
      await h.app.get(StockAvailabilityService).compute({ sellerId, variantId, warehouseId }),
    ).toBe(10);

    const restockMovements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(restockMovements).toHaveLength(1);
    expect(restockMovements[0]!.qtyChange).toBe(2);
    expect(restockMovements[0]!.binId).toBe(floor.id);

    // No ACTIVE reservations — fulfilled at dispatch, not re-created.
    const active = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
    });
    expect(active).toHaveLength(0);
  });

  it('WRITE_OFF happy: NO movement — the pack-time decrement stands (qtyOnHand stays 8)', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, shipmentItemIds, awbNumber } = await makeRtoInitiatedShipment(2);

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
    // RTO_DAMAGED: nothing came back sellable. This asserted
    // RTO_RESTOCKED and passed, because finalize used to land that
    // terminal unconditionally — which made the damage-rate report
    // structurally incapable of ever reading non-zero.
    expect(fin.body).toMatchObject({
      status: OrderStatus.RTO_DAMAGED,
      restockedCount: 0,
      writtenOffCount: 1,
    });

    const afterFinalize = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(afterFinalize.qtyOnHand).toBe(8); // unchanged — the unit left at pack
    expect(afterFinalize.qtyReserved).toBe(0);

    // WRITE_OFF issues NO movement.
    const restockMovements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(restockMovements).toHaveLength(0);

    const active = await h.prisma.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
    });
    expect(active).toHaveLength(0);
  });

  it('gate-2 (RESTOCK): pre-existing RETURN_RESTOCK marker → skip re-apply, transition still runs', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, shipmentItemIds, awbNumber } = await makeRtoInitiatedShipment(2);

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

    // Simulate a prior crash-after-movements: insert a RETURN_RESTOCK
    // marker directly so the gate fires. Test-only INV-1 bypass.
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
        type: StockMovementType.RETURN_RESTOCK,
        qtyChange: 0, // marker; only existence matters for the gate
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

    // Only the manually-inserted marker — no double-apply.
    const restockMovements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(restockMovements).toHaveLength(1);
  });

  it('gate-1 idempotency: re-finalize after success → alreadyFinalized, exactly one RETURN_RESTOCK', async () => {
    await receiveStock(10);
    const { shipmentId, shipmentItemIds, awbNumber } = await makeRtoInitiatedShipment(2);

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

    const restockMovements = await h.prisma.stockMovement.findMany({
      where: { shipmentId, type: StockMovementType.RETURN_RESTOCK },
    });
    expect(restockMovements).toHaveLength(1); // not double-applied
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
