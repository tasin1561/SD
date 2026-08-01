import request from 'supertest';
import { StockAlertService } from '../../src/modules/inventory-shared/stock-alert.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

/**
 * Module 5 inventory end-to-end. Exercises the data-integrity backbone
 * through the real HTTP surface + in-process workers:
 *  - goods-receipt lifecycle incl. DISCREPANCY → resolve → COMPLETED
 *  - concurrent receipts to the same variant (no lost data)
 *  - adjustment above-threshold approval → executor worker → EXECUTED
 *  - cycle count → draft CYCLE_COUNT adjustments per discrepancy
 *  - low-stock alert state machine incl. cooldown gate
 */
describe('Inventory flow (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerAuth: { Authorization: string };
  let sellerId: string;
  let warehouseId: string;
  let binId: string;
  let productId: string;
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
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const email = `inv-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Inv Brand',
        contactPersonName: 'Inv Owner',
        phone: '+8801712345699',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    // Warehouse topology (BLR-01 is seeded).
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
    productId = product.body.id as string;
    const variant = await request(h.baseUrl)
      .post(`/seller/products/${productId}/variants`)
      .set(sellerAuth)
      .send({ skuCode: 'W-1-STD' })
      .expect(201);
    variantId = variant.body.id as string;
  });

  /** Declare → start → record → complete a clean receipt; returns the
   *  created batch id. */
  async function receiveStock(qty: number): Promise<string> {
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
      .send({ lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }] })
      .expect(200);
    const done = await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');
    const batch = await h.prisma.stockBatch.findFirstOrThrow({
      where: { variantId, receivingNoteId: gr.body.id },
    });
    return batch.id;
  }

  it('receipt with discrepancy → DISCREPANCY (no stock) → resolve CORRECT → COMPLETED + movement', async () => {
    const gr = await request(h.baseUrl)
      .post('/seller/goods-receipts')
      .set(sellerAuth)
      .send({ lines: [{ variantId, expectedQty: 10 }] })
      .expect(201);
    const lineId = gr.body.lines[0].id as string;

    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/start-receiving`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/lines`)
      .set(staffAuth)
      .send({ lines: [{ lineId, receivedQty: 7, putawayBinId: binId }] })
      .expect(200);

    const disc = await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
    expect(disc.body.status).toBe('DISCREPANCY');
    // No stock written while DISCREPANCY.
    expect(await h.prisma.stockMovement.count({ where: { variantId } })).toBe(0);

    const resolved = await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/resolve-discrepancy`)
      .set(staffAuth)
      .send({ mode: 'CORRECT', lines: [{ lineId, receivedQty: 10, putawayBinId: binId }] })
      .expect(200);
    expect(resolved.body.status).toBe('COMPLETED');

    const movements = await h.prisma.stockMovement.findMany({ where: { variantId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe('RECEIVING');
    expect(movements[0]?.qtyChange).toBe(10);
    const level = await h.prisma.stockLevel.findFirstOrThrow({ where: { variantId, binId } });
    expect(level.qtyOnHand).toBe(10);

    const completedEmail = await waitFor(() =>
      h.prisma.notificationLog.findFirst({
        where: { templateCode: 'seller.goods_receipt_completed.email' },
      }),
    );
    expect(completedEmail).toBeTruthy();
  });

  it('multiple receipts to the same variant do not lose data (own batch + movement each)', async () => {
    // Sequential: true parallel-write correctness at the stock_levels
    // layer is unit-proven (commit 6, version-CAS, two concurrent
    // applies). Here we assert multi-receipt data CONSERVATION — each
    // receipt gets its own batch + RECEIVING movement and on-hand sums.
    await receiveStock(8);
    await receiveStock(5);
    const batches = await h.prisma.stockBatch.findMany({ where: { variantId } });
    expect(batches).toHaveLength(2);
    const moves = await h.prisma.stockMovement.findMany({
      where: { variantId, type: 'RECEIVING' },
    });
    expect(moves).toHaveLength(2);
    const onHand = await h.prisma.stockLevel.aggregate({
      where: { variantId },
      _sum: { qtyOnHand: true },
    });
    expect(onHand._sum.qtyOnHand).toBe(13);
  });

  it('above-threshold adjustment → PENDING → approve → executor worker → EXECUTED', async () => {
    const batchId = await receiveStock(200);
    const create = await request(h.baseUrl)
      .post('/admin/stock-adjustments')
      .set(staffAuth)
      .send({
        sellerId,
        type: 'DECREASE',
        reasonCode: 'DAMAGED_IN_WAREHOUSE',
        lines: [{ variantId, binId, batchId, qtyChange: -100, unitCostInr: 1000 }],
      })
      .expect(201);
    // |−100 × 1000| = 100000 ≥ 50000 → PENDING
    expect(create.body.status).toBe('PENDING');
    expect(create.body.approverThresholdInr).toBeDefined();
    expect(
      await h.prisma.stockMovement.count({ where: { variantId, type: 'ADJUSTMENT_DECREASE' } }),
    ).toBe(0);

    await request(h.baseUrl)
      .post(`/admin/stock-adjustments/${create.body.id}/approve`)
      .set(staffAuth)
      .expect(200);

    const executed = await waitFor(async () => {
      const a = await h.prisma.stockAdjustment.findUnique({ where: { id: create.body.id } });
      return a?.status === 'EXECUTED' ? a : null;
    });
    expect(executed.status).toBe('EXECUTED');
    const move = await h.prisma.stockMovement.findFirstOrThrow({
      where: { variantId, adjustmentId: create.body.id },
    });
    expect(move.type).toBe('ADJUSTMENT_DECREASE');
    expect(move.qtyChange).toBe(-100);
    const level = await h.prisma.stockLevel.findFirstOrThrow({ where: { variantId, binId } });
    expect(level.qtyOnHand).toBe(100);
  });

  it('cycle count → one PENDING CYCLE_COUNT adjustment per discrepancy', async () => {
    const batchId = await receiveStock(50);
    const cc = await request(h.baseUrl)
      .post('/admin/cycle-counts')
      .set(staffAuth)
      .send({ countType: 'SKU_TARGETED', countDate: '2026-05-20' })
      .expect(201);
    await request(h.baseUrl)
      .post(`/admin/cycle-counts/${cc.body.id}/start`)
      .set(staffAuth)
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/cycle-counts/${cc.body.id}/items`)
      .set(staffAuth)
      .send({ items: [{ variantId, binId, batchId, countedQty: 47 }] }) // system 50 → −3
      .expect(200);
    const done = await request(h.baseUrl)
      .post(`/admin/cycle-counts/${cc.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.discrepancyCount).toBe(1);

    const adj = await h.prisma.stockAdjustment.findFirstOrThrow({
      where: { type: 'CYCLE_COUNT' },
      include: { lines: true },
    });
    expect(adj.status).toBe('PENDING');
    expect(adj.lines).toHaveLength(1);
    expect(adj.lines[0]?.qtyChange).toBe(-3);
    const item = await h.prisma.cycleCountItem.findFirstOrThrow({
      where: { cycleCountId: cc.body.id },
    });
    expect(item.adjustmentId).toBe(adj.id);
  });

  it('low-stock alert: fires once, suppressed within cooldown, refires after cooldown', async () => {
    await receiveStock(20);
    await request(h.baseUrl)
      .patch('/seller/stock/alert-config/default')
      .set(sellerAuth)
      .send({ defaultLowStockThreshold: 5 })
      .expect(200);
    const batch = await h.prisma.stockBatch.findFirstOrThrow({ where: { variantId } });

    // Drop available 20 → 3 (below 5) via an auto-executing adjustment.
    const dropTo = async (delta: number): Promise<void> => {
      await request(h.baseUrl)
        .post('/admin/stock-adjustments')
        .set(staffAuth)
        .send({
          sellerId,
          type: 'DECREASE',
          reasonCode: 'LOST',
          lines: [{ variantId, binId, batchId: batch.id, qtyChange: delta, unitCostInr: 1 }],
        })
        .expect(201);
    };

    await dropTo(-17); // 20 → 3, first breach
    await waitFor(() =>
      h.prisma.notificationLog.findFirst({
        where: { templateCode: 'seller.stock_low_alert.email' },
      }),
    );
    let alertEmails = await h.prisma.notificationLog.count({
      where: { templateCode: 'seller.stock_low_alert.email' },
    });
    expect(alertEmails).toBe(1);

    await dropTo(-1); // 3 → 2, still below, already active → no new email
    await new Promise((r) => setTimeout(r, 300));
    alertEmails = await h.prisma.notificationLog.count({
      where: { templateCode: 'seller.stock_low_alert.email' },
    });
    expect(alertEmails).toBe(1);

    // Recover above threshold → alert state clears (lowStockAlertSentAt
    // preserved for the cooldown calc).
    await receiveStock(50);
    const cleared = await waitFor(async () => {
      const s = await h.prisma.stockAlertState.findFirst({ where: { variantId } });
      return s && s.wasAlertActive === false ? s : null;
    });
    expect(cleared.wasAlertActive).toBe(false);
    const sentAt = cleared.lowStockAlertSentAt!;

    // Drop below again WITHOUT going through the auto-eval path (direct
    // level edit — simulates "stock is low again"; alert state untouched,
    // wasAlertActive still false). Cooldown NOT yet elapsed → SUPPRESSED.
    await h.prisma.stockLevel.updateMany({ where: { variantId }, data: { qtyOnHand: 0 } });
    const alertSvc = h.app.get(StockAlertService);
    const withinCooldown = new Date(sentAt.getTime() + 60 * 60 * 1000); // +1h < 24h
    const suppressed = await alertSvc.evaluate(sellerId, variantId, warehouseId, withinCooldown);
    expect(suppressed.outcome).toBe('SUPPRESSED_COOLDOWN');
    expect(
      await h.prisma.notificationLog.count({
        where: { templateCode: 'seller.stock_low_alert.email' },
      }),
    ).toBe(1);

    // Reset to the post-recovery state, then let the cooldown elapse →
    // a fresh breach refires (2nd email logged end-to-end).
    await h.prisma.stockAlertState.updateMany({
      where: { variantId },
      data: { wasAlertActive: false, lowStockAlertSentAt: sentAt },
    });
    const afterCooldown = new Date(sentAt.getTime() + 25 * 60 * 60 * 1000); // +25h > 24h
    const refired = await alertSvc.evaluate(sellerId, variantId, warehouseId, afterCooldown);
    expect(refired.outcome).toBe('FIRED');
    await waitFor(async () => {
      const c = await h.prisma.notificationLog.count({
        where: { templateCode: 'seller.stock_low_alert.email' },
      });
      return c === 2 ? c : null;
    });
  });
});
