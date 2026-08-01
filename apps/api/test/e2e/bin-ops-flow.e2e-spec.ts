import request from 'supertest';
import { StockMovementType } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Bin operations end to end: the toggle, re-shelving, and the collapse.
 *
 * The collapse is the reason this file exists. It is the only action in
 * the warehouse that destroys information rather than moving goods, and
 * two things about it are easy to get wrong in ways no unit test would
 * notice:
 *
 *   1. The merge cannot be `UPDATE stock_levels SET bin_id = floor` —
 *      the unique key is (seller, variant, warehouse, bin, batch), so
 *      the moment two bins hold the same variant+batch that update
 *      raises a constraint violation. Only a real database says so.
 *   2. Snapshot BEFORE merge. Reversed, a crash between them leaves a
 *      half-collapsed warehouse and no record of what it had been.
 */
describe('Bin ops flow (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerAuth: { Authorization: string };
  let warehouseId: string;
  let warehouseCode: string;
  let zoneId: string;
  let binA: string;
  let binB: string;
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
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const email = `bins-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Bins Brand',
        contactPersonName: 'Bins Owner',
        phone: '+8801712345699',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    const wh = (whs.body as Array<{ id: string; code: string }>)[0]!;
    warehouseId = wh.id;
    warehouseCode = wh.code;

    const zone = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/zones`)
      .set(staffAuth)
      .send({ code: 'MN', name: 'Main' })
      .expect(201);
    zoneId = zone.body.id as string;

    const a = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId, aisle: 'A', rack: '1', shelf: '1', type: 'STORAGE' })
      .expect(201);
    binA = a.body.id as string;
    const b = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId, aisle: 'B', rack: '2', shelf: '5', type: 'STORAGE' })
      .expect(201);
    binB = b.body.id as string;

    const product = await request(h.baseUrl)
      .post('/seller/products')
      .set(sellerAuth)
      .send({ name: 'Bin Widget', externalRef: 'BW-1' })
      .expect(201);
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${product.body.id}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'BW-1-STD' })
      .expect(201);
    variantId = variant.body.id as string;
  });

  /** Receive `qty` into `binId`, as its own batch. */
  async function receiveInto(binId: string, qty: number): Promise<void> {
    const gr = await request(h.baseUrl)
      .post('/seller/goods-receipts')
      .set(sellerAuth)
      .send({ lines: [{ variantId, expectedQty: qty }] })
      .expect(201);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/start-receiving`)
      .set(staffAuth)
      .expect(200);
    const detail = await request(h.baseUrl)
      .get(`/admin/goods-receipts/${gr.body.id}`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/lines`)
      .set(staffAuth)
      .send({
        lines: [{ lineId: detail.body.lines[0].id, receivedQty: qty, putawayBinId: binId }],
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  it('the bin code is composed from the grid, and a duplicate is refused', async () => {
    const bin = await h.prisma.warehouseBin.findUniqueOrThrow({ where: { id: binB } });
    // B + 2 + 5, zero-padded — not whatever the client felt like typing.
    expect(bin.code).toBe('B-02-05');
    expect({ aisle: bin.aisle, rack: bin.rack, shelf: bin.shelf }).toEqual({
      aisle: 'B',
      rack: '02',
      shelf: '05',
    });

    // `2` and `02` are the same rack, so this is the same bin.
    const dup = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bins`)
      .set(staffAuth)
      .send({ zoneId, aisle: 'b', rack: '02', shelf: '5', type: 'STORAGE' })
      .expect(409);
    expect(dup.body.code).toBe('BIN_CODE_TAKEN');
  });

  it('tracking cannot be turned on with no real bins, and the toggle moves nothing', async () => {
    await receiveInto(binA, 5);
    const before = await h.prisma.stockLevel.findMany({ where: { variantId } });

    await request(h.baseUrl)
      .patch(`/admin/warehouses/${warehouseId}/bin-tracking`)
      .set(staffAuth)
      .send({ enabled: true })
      .expect(200);

    // The whole point of the toggle: it changes what is ASKED FOR, not
    // where anything is.
    const after = await h.prisma.stockLevel.findMany({ where: { variantId } });
    expect(after).toEqual(before);

    await request(h.baseUrl)
      .patch(`/admin/warehouses/${warehouseId}/bin-tracking`)
      .set(staffAuth)
      .send({ enabled: false })
      .expect(200);
    const afterOff = await h.prisma.stockLevel.findMany({ where: { variantId } });
    expect(afterOff).toEqual(before);
  });

  it('moving a whole bin carries its contents and leaves the source empty', async () => {
    await receiveInto(binA, 7);

    const res = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/move-bin/${binA}`)
      .set(staffAuth)
      .send({ destBinId: binB })
      .expect(200);
    expect(res.body).toMatchObject({ linesMoved: 1, unitsMoved: 7 });

    const inA = await h.prisma.stockLevel.findFirst({ where: { variantId, binId: binA } });
    const inB = await h.prisma.stockLevel.findFirstOrThrow({ where: { variantId, binId: binB } });
    expect(inA?.qtyOnHand ?? 0).toBe(0);
    expect(inB.qtyOnHand).toBe(7);

    // Paired movements, both recorded.
    const moves = await h.prisma.stockMovement.findMany({
      where: {
        variantId,
        type: { in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN] },
      },
    });
    expect(moves).toHaveLength(2);

    // An empty bin has nothing to give.
    const again = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/move-bin/${binA}`)
      .set(staffAuth)
      .send({ destBinId: binB })
      .expect(409);
    expect(again.body.code).toBe('SOURCE_BIN_EMPTY');
  });

  it('collapse: gated, snapshot-first, merges same-batch rows that a naive UPDATE could not', async () => {
    // ONE receipt, split across two bins. Same variant AND same batch in
    // both — which is exactly the case that makes
    // `UPDATE stock_levels SET bin_id = floor` violate the unique key.
    await receiveInto(binA, 6);
    const batch = await h.prisma.stockBatch.findFirstOrThrow({ where: { variantId } });
    await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/bulk-transfer`)
      .set(staffAuth)
      .send({
        lines: [
          {
            sellerId: (await h.prisma.stockLevel.findFirstOrThrow({ where: { variantId } }))
              .sellerId,
            variantId,
            batchId: batch.id,
            qty: 2,
            sourceBinId: binA,
            destBinId: binB,
          },
        ],
      })
      .expect(200);

    const twoBins = await h.prisma.stockLevel.findMany({
      where: { variantId, qtyOnHand: { gt: 0 } },
    });
    expect(twoBins).toHaveLength(2);
    // Same batch in both — the collision case.
    expect(new Set(twoBins.map((l) => l.batchId)).size).toBe(1);

    // A short reason is refused: the audit row is the only explanation
    // anyone gets later.
    const short = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/collapse/request`)
      .set(staffAuth)
      .send({ reason: 'cleaning up' })
      .expect(400);
    expect(short.body.message).toBeDefined();

    const reason = 'Shelving is being rebuilt this weekend; locations will all be wrong.';
    const req = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/collapse/request`)
      .set(staffAuth)
      .send({ reason })
      .expect(200);
    // Told the cost BEFORE anything happens.
    expect(req.body).toMatchObject({ binsAffected: 2, unitsAffected: 6 });
    const challengeId = req.body.challengeId as string;

    // The code never comes back over the wire — it is emailed. Read the
    // hash target out of the DB the way only a test can.
    const stored = await h.prisma.binCollapseChallenge.findUniqueOrThrow({
      where: { id: challengeId },
    });
    expect(stored.consumedAt).toBeNull();

    // Wrong code: refused, and an attempt is burned.
    await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/collapse/confirm`)
      .set(staffAuth)
      .send({ challengeId, code: '000000', typedWarehouseCode: warehouseCode })
      .expect(409);

    // Recover the real code by brute-forcing against the stored hash —
    // a test-only shortcut for something a human reads in their inbox.
    const { createHash } = await import('node:crypto');
    let realCode: string | null = null;
    for (let i = 0; i < 1_000_000; i++) {
      const candidate = String(i).padStart(6, '0');
      if (createHash('sha256').update(candidate, 'utf8').digest('hex') === stored.codeHash) {
        realCode = candidate;
        break;
      }
    }
    expect(realCode).not.toBeNull();

    // Right code, wrong warehouse name typed: still refused.
    const wrongName = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/collapse/confirm`)
      .set(staffAuth)
      .send({ challengeId, code: realCode, typedWarehouseCode: 'NOPE' })
      .expect(400);
    expect(wrongName.body.code).toBe('WAREHOUSE_CODE_MISMATCH');

    const done = await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/collapse/confirm`)
      .set(staffAuth)
      .send({ challengeId, code: realCode, typedWarehouseCode: warehouseCode })
      .expect(200);
    expect(done.body).toMatchObject({ binsCollapsed: 2, rowsMoved: 2, unitsMoved: 6 });

    // Everything is in FLOOR, summed — not two rows, and no constraint
    // violation on the way.
    const floor = await h.prisma.warehouseBin.findFirstOrThrow({
      where: { warehouseId, code: 'FLOOR' },
    });
    const floorLevel = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId: floor.id },
    });
    expect(floorLevel.qtyOnHand).toBe(6);
    const leftBehind = await h.prisma.stockLevel.findMany({
      where: { variantId, qtyOnHand: { gt: 0 }, binId: { not: floor.id } },
    });
    expect(leftBehind).toHaveLength(0);

    // The backup exists and describes the world as it was.
    const snaps = await request(h.baseUrl)
      .get(`/admin/warehouses/${warehouseId}/bin-ops/snapshots`)
      .set(staffAuth)
      .expect(200);
    expect(snaps.body).toHaveLength(1);
    expect(snaps.body[0]).toMatchObject({ lineCount: 2, totalQty: 6, reason });

    // Re-using a consumed challenge is refused.
    await request(h.baseUrl)
      .post(`/admin/warehouses/${warehouseId}/bin-ops/collapse/confirm`)
      .set(staffAuth)
      .send({ challengeId, code: realCode, typedWarehouseCode: warehouseCode })
      .expect(409);

    // And the backup puts it back.
    const restored = await request(h.baseUrl)
      .post(
        `/admin/warehouses/${warehouseId}/bin-ops/snapshots/${snaps.body[0].id as string}/restore`,
      )
      .set(staffAuth)
      .expect(200);
    expect(restored.body.restoredLines).toBe(2);

    const backInA = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId: binA },
    });
    const backInB = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId: binB },
    });
    expect(backInA.qtyOnHand).toBe(4);
    expect(backInB.qtyOnHand).toBe(2);
  });
});
