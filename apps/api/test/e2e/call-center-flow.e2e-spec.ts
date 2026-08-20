import request from 'supertest';
import {
  CallOutcome,
  CallQueueStatus,
  OrderStatus,
  ReservationStatus,
  StaffRole,
} from '@skydrop/db';
import { AssignmentExpirationService } from '../../src/modules/call-center/services/assignment-expiration.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * Module 7 call-center end-to-end. Exercises the full pull-model
 * lifecycle through the real HTTP surface + the CC-6 enqueue/dequeue
 * coupling + the M5/M6 saga reuse:
 *  1. happy path: submit → auto-enqueue → pull → CONFIRMED (M5 reserve,
 *     INV-4 honored)
 *  2. insufficient stock: CONFIRMED outcome → M5 saga → OUT_OF_STOCK,
 *     attempt persists with outcome=CONFIRMED
 *  3. reschedule: CALLBACK_REQUESTED future availableAt → not pickable
 *     until time advances
 *  4. NDR cap: 3 NO_ANSWER → 3rd is REJECTED_NDR, no re-queue
 *  5. concurrent pullNext (FOR UPDATE SKIP LOCKED) through HTTP
 *  6. assignment expiration → entry back to PENDING + audit
 *  7. bulk-dequeue by seller (CONFIRMED orders untouched)
 */
describe('Call center flow (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let sellerAuth: { Authorization: string };
  let sellerId: string;
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
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    // Claim presence. `agent_call_settings.is_available` defaults to
    // FALSE — being logged in is not being at the desk — and pullNext
    // now enforces it server-side rather than trusting the station's own
    // gate (FE-2). Done through the real endpoint rather than a direct
    // write, so the "Start taking calls" path is exercised too.
    await request(h.baseUrl)
      .patch('/agent/settings')
      .set(staffAuth)
      .send({ isAvailable: true })
      .expect(200);

    const email = `cc-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'CC Brand',
        contactPersonName: 'CC Owner',
        phone: '+8801712345699',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerId = reg.body.seller.id as string;
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

  async function createSubmitted(qty = 2): Promise<string> {
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
    const id = created.body.id as string;
    await request(h.baseUrl).post(`/seller/orders/${id}/submit`).set(sellerAuth).expect(200);
    return id;
  }

  function pullNext(auth: { Authorization: string }) {
    return request(h.baseUrl).post('/agent/calls/next').set(auth);
  }

  function recordAttempt(
    auth: { Authorization: string },
    assignmentId: string,
    body: Record<string, unknown>,
  ): request.Test {
    return request(h.baseUrl)
      .post(`/agent/calls/${assignmentId}/record-attempt`)
      .set(auth)
      .send({ startedAt: new Date().toISOString(), ...body });
  }

  it('1. happy path: submit → auto-enqueue → pull → CONFIRMED (INV-4 honored)', async () => {
    await receiveStock(10);
    const orderId = await createSubmitted(2);

    // CC-6: submit auto-enqueued exactly one PENDING entry.
    const entry = await h.prisma.callQueueEntry.findFirstOrThrow({
      where: { orderId },
    });
    expect(entry.status).toBe(CallQueueStatus.PENDING);

    const pulled = await pullNext(staffAuth).expect(200);
    expect(pulled.body.assignment.orderId).toBe(orderId);
    expect(pulled.body.assignment.order.orderId).toBe(orderId); // enriched
    const assignmentId = pulled.body.assignment.assignmentId as string;

    const rec = await recordAttempt(staffAuth, assignmentId, {
      outcome: CallOutcome.CONFIRMED,
    }).expect(200);
    expect(rec.body.finalOrderStatus).toBe(OrderStatus.CONFIRMED);

    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe(OrderStatus.CONFIRMED);

    const reservations = await h.prisma.stockReservation.findMany({
      where: { orderId },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.status).toBe(ReservationStatus.ACTIVE);
    // INV-4: phase-1 reservation does NOT touch stock_levels.qtyReserved.
    const levels = await h.prisma.stockLevel.findMany({ where: { variantId } });
    expect(levels.reduce((s, l) => s + l.qtyReserved, 0)).toBe(0);

    // The pulled entry is COMPLETED; no OPEN entry remains.
    expect(
      await h.prisma.callQueueEntry.count({
        where: {
          orderId,
          status: { in: [CallQueueStatus.PENDING, CallQueueStatus.ASSIGNED] },
        },
      }),
    ).toBe(0);
  });

  it('2. insufficient stock: CONFIRMED outcome → OUT_OF_STOCK, attempt persists', async () => {
    const orderId = await createSubmitted(5); // no stock received
    const pulled = await pullNext(staffAuth).expect(200);
    const assignmentId = pulled.body.assignment.assignmentId as string;

    const rec = await recordAttempt(staffAuth, assignmentId, {
      outcome: CallOutcome.CONFIRMED,
    }).expect(200);
    expect(rec.body.finalOrderStatus).toBe(OrderStatus.OUT_OF_STOCK);

    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe(OrderStatus.OUT_OF_STOCK);

    // CC-3: the attempt is the source of truth — it persists with the
    // recorded outcome regardless of the saga's routing.
    const attempts = await h.prisma.callAttempt.findMany({ where: { orderId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.outcome).toBe(CallOutcome.CONFIRMED);

    expect(await h.prisma.stockReservation.count({ where: { orderId } })).toBe(0);
    const events = await h.prisma.orderEvent.findMany({
      where: { orderId, toStatus: OrderStatus.OUT_OF_STOCK },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('3. reschedule: CALLBACK_REQUESTED future availableAt is not pickable until it arrives', async () => {
    await receiveStock(10);
    const orderId = await createSubmitted(1);
    const pulled = await pullNext(staffAuth).expect(200);
    const assignmentId = pulled.body.assignment.assignmentId as string;

    const when = new Date(Date.now() + 2 * 60 * 60 * 1000); // now + 2h
    const rec = await recordAttempt(staffAuth, assignmentId, {
      outcome: CallOutcome.CALLBACK_REQUESTED,
      scheduledFor: when.toISOString(),
    }).expect(200);
    expect(rec.body.requeued).toBe(true);

    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe(OrderStatus.CALL_RESCHEDULED);

    // The fresh entry is future-dated → not pickable yet.
    const futureEntry = await h.prisma.callQueueEntry.findFirstOrThrow({
      where: { orderId, status: CallQueueStatus.PENDING },
    });
    expect(futureEntry.availableAt.getTime()).toBeGreaterThan(Date.now());
    const empty = await pullNext(staffAuth).expect(200);
    expect(empty.body.assignment).toBeNull();

    // Advance the clock (simulated): make it available now.
    await h.prisma.callQueueEntry.update({
      where: { id: futureEntry.id },
      data: { availableAt: new Date(Date.now() - 60_000) },
    });
    const again = await pullNext(staffAuth).expect(200);
    expect(again.body.assignment.assignmentId).toBe(futureEntry.id);
  });

  /** Fast-forward a re-queued entry so the next pull can see it. */
  async function makePickableNow(orderId: string): Promise<void> {
    const entry = await h.prisma.callQueueEntry.findFirst({
      where: { orderId, status: CallQueueStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (!entry) return;
    await h.prisma.callQueueEntry.update({
      where: { id: entry.id },
      data: { availableAt: new Date(Date.now() - 60_000) },
    });
  }

  it('4. NDR cap: 3 NO_ANSWER attempts → 3rd is REJECTED_NDR, no re-queue', async () => {
    await receiveStock(10);
    const orderId = await createSubmitted(1);

    for (let i = 1; i <= 2; i += 1) {
      const p = await pullNext(staffAuth).expect(200);
      const r = await recordAttempt(staffAuth, p.body.assignment.assignmentId as string, {
        outcome: CallOutcome.NO_ANSWER,
      }).expect(200);
      expect(r.body.finalOrderStatus).toBe(OrderStatus.CALL_NO_RESPONSE);
      expect(r.body.requeued).toBe(true);
      expect(r.body.hitCap).toBe(false);
      // Advance the clock (simulated), same idiom as test 3 above. A
      // NO_ANSWER re-queue is now future-dated by
      // ops.call_retry_interval_hours — a customer who did not pick up
      // must not be redialled on the spot. This test is about the CAP
      // being counted per ORDER, not about the wait, so it fast-forwards
      // rather than encoding a redial delay it does not care about.
      await makePickableNow(orderId);
    }

    const p3 = await pullNext(staffAuth).expect(200);
    const r3 = await recordAttempt(staffAuth, p3.body.assignment.assignmentId as string, {
      outcome: CallOutcome.NO_ANSWER,
    }).expect(200);
    expect(r3.body.hitCap).toBe(true);
    expect(r3.body.finalOrderStatus).toBe(OrderStatus.REJECTED_NDR);
    expect(r3.body.requeued).toBe(false);

    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe(OrderStatus.REJECTED_NDR);
    expect(
      await h.prisma.callQueueEntry.count({
        where: {
          orderId,
          status: { in: [CallQueueStatus.PENDING, CallQueueStatus.ASSIGNED] },
        },
      }),
    ).toBe(0); // terminal — nothing re-queued
  });

  it('5. concurrent pullNext (SKIP LOCKED) through HTTP: one ASSIGNED, one QUEUE_EMPTY', async () => {
    await receiveStock(10);
    await createSubmitted(1); // exactly ONE pickable entry

    const agent2 = await createTestStaff(h.prisma, {
      email: `cc-agent2-${Date.now()}@ops.io`,
      role: StaffRole.CALL_AGENT,
    });
    const a2Login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: agent2.email, password: agent2.password })
      .expect(200);
    const agent2Auth = { Authorization: `Bearer ${a2Login.body.accessToken}` };

    const [a, b] = await Promise.all([pullNext(staffAuth), pullNext(agent2Auth)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const got = [a.body.assignment, b.body.assignment].filter((x) => x !== null);
    const empty = [a.body.assignment, b.body.assignment].filter((x) => x === null);
    expect(got).toHaveLength(1); // SKIP LOCKED → exactly one winner
    expect(empty).toHaveLength(1);
  });

  it('6. assignment expiration: pulled entry returns to PENDING + audit', async () => {
    await receiveStock(10);
    await createSubmitted(1);
    const pulled = await pullNext(staffAuth).expect(200);
    const assignmentId = pulled.body.assignment.assignmentId as string;

    const assigned = await h.prisma.callQueueEntry.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    expect(assigned.status).toBe(CallQueueStatus.ASSIGNED);

    // Fire the time-based expiry directly (the BullMQ worker delegates
    // to this same method — CC-7).
    const exp = h.app.get(AssignmentExpirationService);
    const out = await exp.expire(assignmentId, assigned.assignedAt!.toISOString());
    expect(out.expired).toBe(true);

    const reverted = await h.prisma.callQueueEntry.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    expect(reverted.status).toBe(CallQueueStatus.PENDING);
    expect(reverted.assignedAgentId).toBeNull();
    expect(reverted.assignedAt).toBeNull();

    const audit = await h.prisma.auditLog.findFirst({
      where: {
        entityId: assignmentId,
        action: 'call_queue.assignment_expired',
      },
    });
    expect(audit).not.toBeNull();

    // A second delivery is a time-based idempotent no-op.
    const again = await exp.expire(assignmentId, assigned.assignedAt!.toISOString());
    expect(again.expired).toBe(false);
  });

  it('7. bulk-dequeue: closes a seller’s OPEN entries, CONFIRMED orders untouched', async () => {
    await receiveStock(10);

    // Created FIRST → FIFO-pulled first → confirm it (entry COMPLETED).
    const confirmedId = await createSubmitted(1);
    const cp = await pullNext(staffAuth).expect(200);
    expect(cp.body.assignment.orderId).toBe(confirmedId);
    await recordAttempt(staffAuth, cp.body.assignment.assignmentId as string, {
      outcome: CallOutcome.CONFIRMED,
    }).expect(200);

    // Two more orders left OPEN in the queue.
    const open1 = await createSubmitted(1);
    const open2 = await createSubmitted(1);

    const res = await request(h.baseUrl)
      .post('/admin/call-queue/bulk-dequeue')
      .set(staffAuth)
      .send({ sellerId, reason: 'Seller suspended (e2e)' })
      .expect(200);
    expect(res.body.sellerId).toBe(sellerId);
    expect(res.body.dequeuedOrders).toBe(2);

    // No OPEN entry remains for the seller.
    expect(
      await h.prisma.callQueueEntry.count({
        where: {
          order: { sellerId },
          status: { in: [CallQueueStatus.PENDING, CallQueueStatus.ASSIGNED] },
        },
      }),
    ).toBe(0);

    // The CONFIRMED order's status is untouched by bulk-dequeue.
    const confirmed = await h.prisma.order.findUniqueOrThrow({
      where: { id: confirmedId },
    });
    expect(confirmed.status).toBe(OrderStatus.CONFIRMED);
    // The two dequeued orders stayed PENDING_CONFIRMATION (only the
    // queue entry closed, not the order).
    for (const oid of [open1, open2]) {
      const o = await h.prisma.order.findUniqueOrThrow({ where: { id: oid } });
      expect(o.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    }
  });
});
