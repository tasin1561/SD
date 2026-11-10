import request from 'supertest';
import { ActorType, ManifestStatus, OrderStatus } from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  claimPick,
  resetAuthState,
  type AppHarness,
  packAtBench,
} from './app-harness';

/**
 * MORE THAN TWO PACKERS, ALL DAY (owner, 2026-11-10).
 *
 * Every assertion here needs a REAL DATABASE and is worthless without
 * one: a mocked Prisma has no row locks, no partial unique indexes and
 * no `now()`, so the three mechanisms under test (SKIP LOCKED, the
 * PACK-4 claim written inside its own UPDATE, and the WMS-7b advisory
 * lock shared by manifest attach and close) would all appear to work
 * while proving nothing. There is no local docker on this machine, so
 * this file runs in CI only.
 *
 * What it pins down:
 *   1. Two packers pulling SEQUENTIALLY get DIFFERENT parcels. This is
 *      the gap `PackQueueService`'s own comment predicted and the owner
 *      hit — nothing was ever corrupted (the pack box refuses the second
 *      packer), it cost the second packer the walk.
 *   2. Two packers pulling SIMULTANEOUSLY get different parcels (the
 *      pre-existing SKIP LOCKED guarantee, re-pinned now that the same
 *      statement also writes a claim).
 *   3. A claim EXPIRES by predicate — no sweeper, so nothing can strand
 *      a parcel when a packer goes home.
 *   4. A packer can put a parcel back (`release`) without waiting.
 *   5. An open box on another bench takes the parcel off this bench's
 *      list, and the packer's OWN box does not.
 *   6. A parcel can never end up PACKED on a CLOSED manifest, however
 *      the pack and the close interleave (WMS-7b).
 */
describe('Warehouse pack concurrency (e2e)', () => {
  let h: AppHarness;
  let packerA: { Authorization: string };
  let packerB: { Authorization: string };
  let staffId: string;
  let packerBId: string;
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

    const a = await createTestStaff(h.prisma);
    staffId = a.id;
    const aLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: a.email, password: a.password })
      .expect(200);
    packerA = { Authorization: `Bearer ${aLogin.body.accessToken}` };

    // A SECOND real staff member, because every claim in PACK-4 is per
    // operator: one login scanning twice proves none of it.
    const b = await createTestStaff(h.prisma);
    packerBId = b.id;
    const bLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: b.email, password: b.password })
      .expect(200);
    packerB = { Authorization: `Bearer ${bLogin.body.accessToken}` };

    const email = `pack-conc-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(packerA)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Pack Conc Brand',
        contactPersonName: 'Pack Owner',
        phone: '+8801712345678',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const whs = await request(h.baseUrl).get('/admin/warehouses').set(packerA).expect(200);
    warehouseId = (whs.body as Array<{ id: string; code: string }>).find(
      (w) => w.code === 'CCU-01',
    )!.id;
    const zone = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/zones`)
      .set(packerA)
      .send({ code: 'A', name: 'Zone A' })
      .expect(201);
    const bin = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(packerA)
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
      .set(packerA)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/lines`)
      .set(packerA)
      .send({ lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }] })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(packerA)
      .expect(200);
  }

  async function makePickedShipment(qty = 1): Promise<{ orderId: string; shipmentId: string }> {
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
    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    const prov = await h.app.get(ShipmentProvisionService).provisionFromSnapshot({
      orderId,
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
    const shipmentId = prov.shipmentId;

    await claimPick(h.baseUrl, packerA, shipmentId);
    const resv = await h.prisma.stockReservation.findFirstOrThrow({
      where: { orderId, status: 'ACTIVE', NOT: { binId: null } },
    });
    const items = await h.prisma.shipmentItem.findMany({
      where: { shipmentId },
      select: { id: true },
    });
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/items`)
      .set(packerA)
      .send({ shipmentItemId: items[0]!.id, pickedBinId: resv.binId, pickedBatchId: resv.batchId })
      .expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipmentId}/complete`)
      .set(packerA)
      .expect(200);
    return { orderId, shipmentId };
  }

  const pull = (auth: { Authorization: string }) =>
    request(h.baseUrl).post('/warehouse/packs/next').set(auth);
  const queue = (auth: { Authorization: string }) =>
    request(h.baseUrl).get('/warehouse/packs/queue').set(auth);

  it('1. two packers pulling ONE AFTER THE OTHER are given DIFFERENT parcels', async () => {
    // The named gap. Before PACK-4 both pulls returned the oldest
    // parcel and packer B only found out at the bench, holding goods.
    await receiveStock(10);
    const first = await makePickedShipment();
    const second = await makePickedShipment();

    const a = await pull(packerA).expect(200);
    const b = await pull(packerB).expect(200);

    expect(a.body.pack).not.toBeNull();
    expect(b.body.pack).not.toBeNull();
    expect(a.body.pack.shipmentId).not.toBe(b.body.pack.shipmentId);
    expect([first.shipmentId, second.shipmentId].sort()).toEqual(
      [a.body.pack.shipmentId, b.body.pack.shipmentId].sort(),
    );

    // The claim is on the row, with a deadline, and it belongs to the
    // packer who pulled it.
    const claimed = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: a.body.pack.shipmentId as string },
      select: { packClaimedByStaffId: true, packClaimExpiresAt: true },
    });
    expect(claimed.packClaimedByStaffId).toBe(staffId);
    expect(claimed.packClaimExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('2. ONE parcel, two packers: the second is told the queue is empty, not sent after it', async () => {
    await receiveStock(10);
    const only = await makePickedShipment();

    const a = await pull(packerA).expect(200);
    expect(a.body.pack.shipmentId).toBe(only.shipmentId);

    const b = await pull(packerB).expect(200);
    expect(b.body.pack).toBeNull();

    // And B's bench EXPLAINS it rather than the row simply vanishing.
    const bQueue = await queue(packerB).expect(200);
    expect(bQueue.body.waiting).toHaveLength(0);
    expect(bQueue.body.inProgress).toHaveLength(1);
    expect(bQueue.body.inProgress[0]).toMatchObject({
      shipmentId: only.shipmentId,
      hold: 'CLAIM',
      heldByStaffId: staffId,
    });
    expect(bQueue.body.inProgress[0].heldByName).not.toBeNull();

    // A's own list still has it: a claim never hides a parcel from the
    // packer holding it.
    const aQueue = await queue(packerA).expect(200);
    expect(aQueue.body.waiting.map((w: { shipmentId: string }) => w.shipmentId)).toContain(
      only.shipmentId,
    );
  });

  it('3. a claim EXPIRES in the predicate — no sweeper, so nothing strands', async () => {
    await receiveStock(10);
    const only = await makePickedShipment();
    await pull(packerA).expect(200);

    // Exactly what a packer going home looks like to the database. No
    // job runs; the deadline simply passes.
    await h.prisma.shipment.update({
      where: { id: only.shipmentId },
      data: { packClaimExpiresAt: new Date(Date.now() - 60_000) },
    });

    const b = await pull(packerB).expect(200);
    expect(b.body.pack).not.toBeNull();
    expect(b.body.pack.shipmentId).toBe(only.shipmentId);
    const row = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: only.shipmentId },
      select: { packClaimedByStaffId: true },
    });
    expect(row.packClaimedByStaffId).toBe(packerBId);
  });

  it('4. a packer can hand a parcel straight back (release), and only their own', async () => {
    await receiveStock(10);
    const only = await makePickedShipment();
    await pull(packerA).expect(200);

    // B cannot release A's claim — and is not given an error for it
    // either: "somebody else can have it" is not true, so `released`
    // is false and nothing moved.
    const wrong = await request(h.baseUrl)
      .post(`/warehouse/packs/${only.shipmentId}/release`)
      .set(packerB)
      .expect(200);
    expect(wrong.body.released).toBe(false);
    expect((await pull(packerB).expect(200)).body.pack).toBeNull();

    const mine = await request(h.baseUrl)
      .post(`/warehouse/packs/${only.shipmentId}/release`)
      .set(packerA)
      .expect(200);
    expect(mine.body.released).toBe(true);

    const b = await pull(packerB).expect(200);
    expect(b.body.pack.shipmentId).toBe(only.shipmentId);
  });

  it('5. an OPEN BOX on another bench takes the parcel off this bench, but not off its own', async () => {
    await receiveStock(10);
    const only = await makePickedShipment();
    const shipment = await h.prisma.shipment.findUniqueOrThrow({
      where: { id: only.shipmentId },
      select: { awbNumber: true },
    });

    await request(h.baseUrl)
      .post('/warehouse/packs/boxes/open')
      .set(packerA)
      .send({ awbNumber: shipment.awbNumber })
      .expect(200);

    const bQueue = await queue(packerB).expect(200);
    expect(bQueue.body.waiting).toHaveLength(0);
    expect(bQueue.body.inProgress[0]).toMatchObject({ hold: 'BOX', heldByStaffId: staffId });
    expect((await pull(packerB).expect(200)).body.pack).toBeNull();

    // LBL-4's STRICT resume depends on this: the packer who owns the box
    // must still see their parcel.
    const aQueue = await queue(packerA).expect(200);
    expect(aQueue.body.waiting.map((w: { shipmentId: string }) => w.shipmentId)).toContain(
      only.shipmentId,
    );
  });

  it('6. two SIMULTANEOUS pulls (SKIP LOCKED) still take different parcels', async () => {
    await receiveStock(10);
    await makePickedShipment();
    await makePickedShipment();

    const [a, b] = await Promise.all([pull(packerA), pull(packerB)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ids = [a.body.pack?.shipmentId, b.body.pack?.shipmentId].filter(
      (x): x is string => typeof x === 'string',
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('7. WMS-7b: a parcel is NEVER left PACKED on a CLOSED manifest', async () => {
    // Pack one parcel so a DRAFT manifest exists, then race a second
    // pack against closing that manifest. Whichever order they land in,
    // the invariant is the same: a packed parcel is either on an open
    // manifest or on a closed one that MOVED it on.
    await receiveStock(10);
    const first = await makePickedShipment();
    const second = await makePickedShipment();

    const packedFirst = await packAtBench(h.baseUrl, packerA, h.prisma, first.shipmentId);
    const manifestId = packedFirst.body.manifestId as string;

    await Promise.all([
      packAtBench(h.baseUrl, packerB, h.prisma, second.shipmentId),
      request(h.baseUrl).post(`/admin/warehouse/manifests/${manifestId}/close`).set(packerA),
    ]);

    for (const s of [first, second]) {
      const row = await h.prisma.shipment.findUniqueOrThrow({
        where: { id: s.shipmentId },
        select: { manifestId: true, manifest: { select: { status: true } } },
      });
      expect(row.manifestId).not.toBeNull();
      const order = await h.prisma.order.findUniqueOrThrow({
        where: { id: s.orderId },
        select: { status: true },
      });
      if (row.manifest!.status === ManifestStatus.DRAFT) {
        // Still waiting to be closed — PACKED is correct.
        expect(order.status).toBe(OrderStatus.PACKED);
      } else {
        // On a manifest that has been closed, so the close must have
        // carried it along. A parcel left PACKED here is the stranded
        // one: no AWB job knows about it and neither repair path can
        // reach it.
        expect(order.status).not.toBe(OrderStatus.PACKED);
      }
    }
  });
});
