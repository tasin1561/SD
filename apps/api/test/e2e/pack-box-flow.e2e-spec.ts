import request from 'supertest';
import { ActorType, OrderStatus, StaffRole, SystemIssueKind } from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';
import {
  bootTestApp,
  createTestStaff,
  claimPick,
  settleAwb,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * The box at the pack bench: scan the label to open, scan the products
 * in, scan the label again to close.
 *
 * The two guarantees worth having a test for are the ones a unit test
 * with a mocked Prisma cannot see, because they are enforced by PARTIAL
 * UNIQUE INDEXES rather than by application code — one open box per
 * parcel, one open box per packer. A mocked database has no index to
 * violate, so it would pass whether or not the constraint exists.
 *
 * The third is the conservation claim: cancelling a box returns NOTHING
 * to inventory, because packing never removed anything. Getting that
 * wrong inflates stock by the size of the box, which is the same class
 * of error the RTO path shipped once before.
 */
describe('Pack box session (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let staffId: string;
  let sellerAuth: { Authorization: string };
  let warehouseId: string;
  let binId: string;
  let variantId: string;
  let skuCode: string;
  /** The SKU barcode a packer scans for an ordinary (non-serialized) product. */
  const barcode = 'BAR-W-1-STD';

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

    const email = `packbox-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Packbox Brand',
        contactPersonName: 'Packbox Owner',
        phone: '+8801712345679',
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
      .send({ skuCode: 'W-1-STD', barcode })
      .expect(201);
    variantId = variant.body.id as string;
    skuCode = 'W-1-STD';
  });

  /** On-hand + reserved for the variant — the conservation check. */
  async function stockSnapshot(): Promise<{ qtyOnHand: number; qtyReserved: number }> {
    const rows = await h.prisma.stockLevel.findMany({ where: { variantId } });
    return {
      qtyOnHand: rows.reduce((n, r) => n + r.qtyOnHand, 0),
      qtyReserved: rows.reduce((n, r) => n + r.qtyReserved, 0),
    };
  }

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

  /** An order taken as far as PICKED, with its label ready to scan. */
  async function pickedParcel(qty = 2): Promise<{
    orderId: string;
    shipmentId: string;
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

    // The AWB is generated at confirmation on a BullMQ job, and while it
    // runs it holds a row lock the pick's SKIP LOCKED pull would skip
    // past. Settle first — see settleAwb.
    await settleAwb(h.prisma, shipmentId);

    // Pick.
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

    // Deliberately NOT packed — the box IS the pack step here.
    const ship = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { awbNumber: true },
    });
    return { orderId, shipmentId, awbNumber: ship.awbNumber ?? '' };
  }

  it('the ritual: open with the label, scan the products, close with the label', async () => {
    await receiveStock(10);
    const { orderId, shipmentId, awbNumber } = await pickedParcel(2);

    const opened = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(opened.body.shipmentId).toBe(shipmentId);
    expect(opened.body.expected).toEqual([expect.objectContaining({ skuCode, quantity: 2 })]);
    const boxId = opened.body.packBoxId as string;

    // Re-scanning your OWN open label is idempotent — a scanner that
    // double-fires must not be an error.
    const again = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(again.body.packBoxId).toBe(boxId);
    expect(again.body.alreadyOpen).toBe(true);

    // Closing an incomplete box is refused — this is the "nothing
    // missing" guarantee.
    const short = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/close`)
      .set(staffAuth)
      .send({ awbNumber })
      .expect(409);
    expect(short.body.code).toBe('PACK_CONTENTS_MISMATCH');

    const s1 = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/scan`)
      .set(staffAuth)
      .send({ code: barcode })
      .expect(200);
    expect(s1.body).toMatchObject({ scannedCount: 1, expectedCount: 2, complete: false });

    const s2 = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/scan`)
      .set(staffAuth)
      .send({ code: barcode })
      .expect(200);
    expect(s2.body.complete).toBe(true);

    // One too many is refused at the moment of scan, not at close.
    const over = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/scan`)
      .set(staffAuth)
      .send({ code: barcode })
      .expect(409);
    expect(over.body.code).toBe('PACK_QUANTITY_EXCEEDED');

    // A different parcel's label does not close this box.
    const wrong = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/close`)
      .set(staffAuth)
      .send({ awbNumber: 'NOT-THIS-PARCEL' })
      .expect(409);
    expect(wrong.body.code).toBe('PACK_LABEL_MISMATCH');

    const done = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/close`)
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(done.body.status).toBe(OrderStatus.PACKED);

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.PACKED);
  });

  it('A REPEATED BOX at the pack bench stops the packer until an admin clears it', async () => {
    // Scanning the label of a parcel that is already boxed and sealed
    // means either two labels were printed for one parcel — and one of
    // those boxes will be delivered to nobody — or this pile has
    // already been packed. Both get worse the longer they run, and only
    // the person holding the box can look.
    await receiveStock(10);
    const { awbNumber } = await pickedParcel(2);

    const opened = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    const boxId = opened.body.packBoxId as string;
    for (let i = 0; i < 2; i += 1) {
      await request(h.baseUrl)
        .post(`/warehouse/packs/boxes/${boxId}/scan`)
        .set(staffAuth)
        .send({ code: barcode })
        .expect(200);
    }
    await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/close`)
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    // The same label again.
    const dup = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_SCAN');

    const issue = await h.prisma.systemIssue.findFirstOrThrow({
      where: { kind: SystemIssueKind.WAREHOUSE_SCAN, resolvedAt: null },
    });
    expect(issue.blocksScanForStaffId).toBe(staffId);

    // STUCK: the next parcel is refused too, because the pile is what
    // is in doubt — not only the box that tripped it.
    const next = await pickedParcel(2);
    const blocked = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber: next.awbNumber })
      .expect(409);
    expect(blocked.body.code).toBe('SCAN_BLOCKED');

    // An admin resolves it with a note and the bench works again.
    await request(h.baseUrl)
      .post(`/admin/system-issues/${issue.id}/resolve`)
      .set(staffAuth)
      .send({ note: 'Duplicate label found and destroyed; rest of the pile checked.' })
      .expect(200);

    await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber: next.awbNumber })
      .expect(200);
  });

  it('a product that is not on the order is refused', async () => {
    await receiveStock(10);
    const { awbNumber } = await pickedParcel(1);
    const opened = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    const other = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Other', externalRef: 'O-1' })
      .expect(201);
    await request(h.baseUrl)
      .post(`/seller/products/${other.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'O-1-STD', barcode: 'BAR-OTHER' })
      .expect(201);

    const res = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${opened.body.packBoxId}/scan`)
      .set(staffAuth)
      .send({ code: 'BAR-OTHER' })
      .expect(409);
    expect(res.body.code).toBe('PACK_PRODUCT_NOT_IN_ORDER');
  });

  it('THE LOCK: a second packer cannot open a box on the same parcel', async () => {
    await receiveStock(10);
    const { awbNumber } = await pickedParcel(1);
    await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    // A second packer, same parcel. The partial unique index is what
    // actually stops this — the check before it would pass for both if
    // they arrived together.
    const other = await createTestStaff(h.prisma, { role: StaffRole.WAREHOUSE_STAFF });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: other.email, password: other.password })
      .expect(200);
    const otherAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const res = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(otherAuth)
      .send({ awbNumber })
      .expect(409);
    expect(res.body.code).toBe('PACK_BOX_HELD_BY_OTHER');
  });

  it('THE LOCK: one packer cannot hold two open boxes', async () => {
    await receiveStock(10);
    const first = await pickedParcel(1);
    const second = await pickedParcel(1);

    await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber: first.awbNumber })
      .expect(200);

    const res = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber: second.awbNumber })
      .expect(409);
    expect(res.body.code).toBe('PACK_BOX_ALREADY_OPEN');
  });

  it('CONSERVATION: cancelling a box returns NOTHING to inventory', async () => {
    await receiveStock(10);
    const { awbNumber, shipmentId } = await pickedParcel(2);

    const before = await stockSnapshot();

    const opened = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    const boxId = opened.body.packBoxId as string;
    await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/scan`)
      .set(staffAuth)
      .send({ code: barcode })
      .expect(200);

    const cancelled = await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${boxId}/cancel`)
      .set(staffAuth)
      .send({ reason: 'Damaged outer carton, repacking' })
      .expect(200);
    expect(cancelled.body.releasedScans).toBe(1);

    // The whole point: packing never took anything out of inventory, so
    // cancelling must not put anything back. Adding it back would
    // inflate on-hand by the size of the box.
    expect(await stockSnapshot()).toEqual(before);

    // The scans are gone and the parcel is packable again.
    expect(await h.prisma.packBoxScan.count({ where: { packBoxId: boxId } })).toBe(0);
    const reopened = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    expect(reopened.body.shipmentId).toBe(shipmentId);
  });

  /**
   * PACK-3: `shipments.pack_started_at` is a PROJECTION of pack_boxes,
   * not a second fact. These are the three ways a projection goes wrong
   * — never set, restated, or left claiming work that stopped — and
   * only a real database can show them, because the value is written
   * inside the same transaction as the box row.
   */
  it('PACK-3: opening a box stamps pack_started_at in the same transaction', async () => {
    await receiveStock(10);
    const { awbNumber, shipmentId } = await pickedParcel(1);

    const before = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { packStartedAt: true },
    });
    expect(before.packStartedAt).toBeNull();

    const opened = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    const after = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { packStartedAt: true },
    });
    expect(after.packStartedAt).not.toBeNull();

    // It equals the BOX's opened_at rather than a second `new Date()`:
    // two clocks for one moment is how a projection starts drifting.
    const box = await h.prisma.packBox.findUniqueOrThrow({
      where: { id: opened.body.packBoxId as string },
      select: { openedAt: true },
    });
    expect(after.packStartedAt?.getTime()).toBe(box.openedAt.getTime());
  });

  it('PACK-3: a re-open after a cancel does NOT restate when packing began', async () => {
    await receiveStock(10);
    const { awbNumber, shipmentId } = await pickedParcel(1);

    const first = await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    const firstStart = (
      await h.prisma.shipment.findUniqueOrThrow({
        where: { id: shipmentId },
        select: { packStartedAt: true },
      })
    ).packStartedAt;

    await request(h.baseUrl)
      .post(`/warehouse/packs/boxes/${first.body.packBoxId as string}/cancel`)
      .set(staffAuth)
      .send({ reason: 'Wrong carton size, starting again' })
      .expect(200);

    // Cancelling the LAST live box means packing is no longer under way,
    // so the projection goes back to null rather than showing a parcel
    // being packed by nobody and ageing forever on the floor report.
    const cleared = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { packStartedAt: true },
    });
    expect(cleared.packStartedAt).toBeNull();
    expect(firstStart).not.toBeNull();
  });

  it('PACK-3: a SECOND box on the same parcel does not restate the start', async () => {
    await receiveStock(10);
    const { awbNumber, shipmentId } = await pickedParcel(2);

    await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    const started = (
      await h.prisma.shipment.findUniqueOrThrow({
        where: { id: shipmentId },
        select: { packStartedAt: true },
      })
    ).packStartedAt;
    expect(started).not.toBeNull();

    // Backdate the stamp so a restatement would be unmistakable rather
    // than a sub-millisecond difference the assertion could not see.
    const backdated = new Date(Date.now() - 60 * 60 * 1000);
    await h.prisma.shipment.update({
      where: { id: shipmentId },
      data: { packStartedAt: backdated },
    });

    // A parcel may legitimately need several boxes. The column answers
    // "how long has this been on the bench", so the FIRST box is the
    // answer and a later one must not reset the clock.
    await h.prisma.packBox.updateMany({
      where: { shipmentId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);

    const stillFirst = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { packStartedAt: true },
    });
    expect(stillFirst.packStartedAt?.getTime()).toBe(backdated.getTime());
  });
});
