import request from 'supertest';
import { ActorType, BulkUploadStatus, OrderStatus, ReservationStatus } from '@skydrop/db';
import { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

/**
 * Module 6 order management end-to-end. Exercises the lifecycle through
 * the real HTTP surface + the M5 reservation saga + in-process CSV
 * worker + god mode:
 *  - create → submit → (simulated M7) CONFIRMED → reservation ACTIVE,
 *    INV-4 honored
 *  - confirmed → admin cancel → reservation RELEASED
 *  - confirm with no stock → OUT_OF_STOCK, no reservation, event reason
 *  - CSV state-aware idempotent re-upload
 *  - god-mode force-mutation guardrails + hasAdminOverride + CRITICAL
 *  - admin release-reservations
 */
describe('Order flow (e2e)', () => {
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

    const email = `ord-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Ord Brand',
        contactPersonName: 'Ord Owner',
        phone: '+8801712345698',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
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
      .send({ lines: [{ lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId }] })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  function createOrderBody(qty = 2, ref?: string): Record<string, unknown> {
    return {
      ...(ref ? { sellerOrderRef: ref } : {}),
      recipientName: 'Asha Verma',
      recipientPhoneE164: '+919876543210',
      recipientAddressLine1: '12 MG Road',
      recipientCity: 'Bengaluru',
      recipientStateProvince: 'Karnataka',
      recipientPostalCode: '560001',
      paymentMode: 'COD',
      codAmountInr: 999,
      items: [{ variantId, quantity: qty }],
    };
  }

  async function createSubmitted(qty = 2): Promise<string> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send(createOrderBody(qty))
      .expect(201);
    const id = created.body.id as string;
    await request(h.baseUrl).post(`/seller/orders/${id}/submit`).set(sellerAuth).expect(200);
    return id;
  }

  function write(): OrderWriteService {
    return h.app.get(OrderWriteService);
  }

  it('happy path: create → submit → CONFIRMED reserves stock (INV-4 honored)', async () => {
    await receiveStock(10);
    const orderId = await createSubmitted(2);

    const res = await write().transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    expect(res.status).toBe(OrderStatus.CONFIRMED);
    expect(res.reservationOutcome).toBe('RESERVED');

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(order.confirmedAt).not.toBeNull();

    const reservations = await h.prisma.stockReservation.findMany({ where: { orderId } });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.status).toBe(ReservationStatus.ACTIVE);
    expect(reservations[0]!.binId).toBeNull(); // phase-1
    expect(reservations[0]!.batchId).toBeNull();
    expect(reservations[0]!.qtyReserved).toBe(2);

    // INV-4: phase-1 reservation does NOT touch stock_levels.qtyReserved.
    const levels = await h.prisma.stockLevel.findMany({ where: { variantId } });
    expect(levels.reduce((s, l) => s + l.qtyReserved, 0)).toBe(0);
  });

  it('cancel cycle: confirmed → admin cancel → reservation RELEASED', async () => {
    await receiveStock(10);
    const orderId = await createSubmitted(2);
    await write().transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    await request(h.baseUrl)
      .post(`/admin/orders/${orderId}/cancel`)
      .set(staffAuth)
      .send({ cancellationReason: 'CUSTOMER_REQUESTED', note: 'e2e cancel' })
      .expect(200);

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.CANCELLED_BY_ADMIN);
    const reservations = await h.prisma.stockReservation.findMany({ where: { orderId } });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.status).toBe(ReservationStatus.RELEASED);
  });

  it('insufficient stock at confirmation → OUT_OF_STOCK, no reservation, event reason', async () => {
    // No stock received.
    const orderId = await createSubmitted(5);
    const res = await write().transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    expect(res.status).toBe(OrderStatus.OUT_OF_STOCK);
    expect(res.reservationOutcome).toBe('OUT_OF_STOCK');

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.OUT_OF_STOCK);

    const reservations = await h.prisma.stockReservation.findMany({ where: { orderId } });
    expect(reservations).toHaveLength(0);

    const events = await h.prisma.orderEvent.findMany({
      where: { orderId, toStatus: OrderStatus.OUT_OF_STOCK },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => /out of stock/i.test(e.description ?? ''))).toBe(true);
  });

  it('CSV import: state-aware idempotent re-upload', async () => {
    const spaces = h.app.get(SpacesService);
    const header =
      'Product SKU,Quantity,Customer Name,Customer Phone,Address Line1,City,State,Pin Code,COD Amount,External Ref';
    const csv = `${header}\n${skuCode},3,Asha,+919876543210,12 MG Road,Bengaluru,Karnataka,560001,500,CSV-REF-1\n`;

    const runImport = async (): Promise<{
      ordersCreated: number;
      rowsSkipped: number;
      rowsFailed: number;
      status: BulkUploadStatus;
    }> => {
      const presign = await request(h.baseUrl)
        .post('/seller/order-imports/presign')
        .set(sellerAuth)
        .send({ fileName: 'orders.csv' })
        .expect(200);
      await spaces.putObject(presign.body.spacesKey, Buffer.from(csv, 'utf8'), 'text/csv');
      const proc = await request(h.baseUrl)
        .post('/seller/order-imports/process')
        .set(sellerAuth)
        .send({ spacesKey: presign.body.spacesKey, fileName: 'orders.csv' })
        .expect(202);
      const row = await waitFor(
        async () => {
          const u = await h.prisma.bulkOrderUpload.findUnique({ where: { id: proc.body.id } });
          return u &&
            u.status !== BulkUploadStatus.PENDING &&
            u.status !== BulkUploadStatus.PROCESSING
            ? u
            : null;
        },
        { description: 'bulk order upload terminal', timeoutMs: 15000 },
      );
      return row;
    };

    const first = await runImport();
    expect(first.status).toBe(BulkUploadStatus.COMPLETED);
    expect(first.ordersCreated).toBe(1);

    const second = await runImport();
    expect(second.status).toBe(BulkUploadStatus.COMPLETED);
    expect(second.ordersCreated).toBe(0); // matched existing
    expect(second.rowsSkipped).toBe(1);

    // Exactly one order for that externalRef, in PENDING_CONFIRMATION.
    const orders = await h.prisma.order.findMany({
      where: { sellerId, sellerOrderRef: 'CSV-REF-1' },
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.status).toBe(OrderStatus.PENDING_CONFIRMATION);
  });

  it('god mode: force DRAFT→DISPATCHED — flag + CRITICAL audit + event, no reservation', async () => {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send(createOrderBody(2))
      .expect(201);
    const orderId = created.body.id as string;

    const reason = 'E2E god-mode bypass verifying the override path end to end';
    await request(h.baseUrl)
      .post(`/admin/orders/${orderId}/force-mutation`)
      .set(staffAuth)
      .send({ targetStatus: 'DISPATCHED', reason, acknowledgeDataIntegrityRisk: true })
      .expect(200);

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DISPATCHED);
    expect(order.hasAdminOverride).toBe(true);

    // No reservation auto-created (DRAFT→DISPATCHED is not → CONFIRMED).
    expect(await h.prisma.stockReservation.count({ where: { orderId } })).toBe(0);

    const audit = await h.prisma.auditLog.findFirst({
      where: { entityId: orderId, action: 'order.force_mutation' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as Record<string, unknown>).severity).toBe('CRITICAL');

    const evt = await h.prisma.orderEvent.findFirst({
      where: { orderId, type: 'NOTE_ADDED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(evt).not.toBeNull();
    expect(evt!.description).toContain('admin_force_mutation');
    expect((evt!.data as Record<string, unknown>).requestId).toBeTruthy();

    // guardrail: short reason rejected
    await request(h.baseUrl)
      .post(`/admin/orders/${orderId}/force-mutation`)
      .set(staffAuth)
      .send({ targetStatus: 'DELIVERED', reason: 'too short', acknowledgeDataIntegrityRisk: true })
      .expect(400);
    // guardrail: ack not literal true
    await request(h.baseUrl)
      .post(`/admin/orders/${orderId}/force-mutation`)
      .set(staffAuth)
      .send({ targetStatus: 'DELIVERED', reason, acknowledgeDataIntegrityRisk: false })
      .expect(400);
  });

  it('admin release-reservations: confirmed order → manual release', async () => {
    await receiveStock(10);
    const orderId = await createSubmitted(2);
    await write().transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    expect(
      await h.prisma.stockReservation.count({
        where: { orderId, status: ReservationStatus.ACTIVE },
      }),
    ).toBe(1);

    const res = await request(h.baseUrl)
      .post(`/admin/orders/${orderId}/release-reservations`)
      .set(staffAuth)
      .send({ reason: 'e2e manual release after god-mode' })
      .expect(200);
    expect(res.body.releasedCount).toBe(1);

    const reservations = await h.prisma.stockReservation.findMany({ where: { orderId } });
    expect(reservations[0]!.status).toBe(ReservationStatus.RELEASED);
  });
});
