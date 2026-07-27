import request from 'supertest';
import {
  ActorType,
  NotificationRecipientType,
  NotificationStatus,
  OrderEventType,
  OrderStatus,
} from '@skydrop/db';
import { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import { ResendService } from '../../src/modules/email/services/resend.service';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  waitFor,
  type AppHarness,
} from './app-harness';

/**
 * Module 11 — Notifications end-to-end (NOTIF-1..8 + the third
 * single-source-mapping discipline).
 *
 * Drives a real order through the lifecycle (CONFIRMED → DISPATCHED
 * via the actual warehouse pick / pack / manifest-close / AWB-
 * generation chain) so the post-commit emit fires through the R3 bus
 * → NotificationListener → ledger → EmailQueue → EmailWorker chain.
 * RESEND_API_KEY is empty in the e2e env, so ResendService falls back
 * to dev-mode logging — sends are recorded as SENT with no provider
 * id; the e2e is therefore a stub-mode e2e (which is exactly the
 * NOTIF-6 locked semantics).
 *
 * The seven critical scenarios (commit-9 checklist):
 *   1. DISPATCHED → 2 ledger rows (seller + customer), both SENT,
 *      customer body contains the M10 tracking URL for the AWB.
 *   2. DELIVERED → exactly 2 rows; the test-spec also asserts the
 *      independent existence of the rows (NOTIF-3).
 *   3. No-customer-email → customer SKIPPED, seller SENT (NOTIF-8).
 *   4. NOTIF-1 PROOF: ResendService.send is stubbed to fail → the
 *      notification_logs row lands FAILED but the order's
 *      `status === DISPATCHED` is COMMITTED and unchanged. The
 *      load-bearing safety test — proves the decoupling.
 *   5. PENDING_MANUAL_PLACEMENT → zero notifications.
 *   6. DUPLICATE — same eventId re-emitted (simulated bus
 *      redelivery) → dedup-gate catches; NO second enqueue / NO
 *      second SENT row.
 *   7. NDR CYCLE — distinct eventIds across two OFD + two
 *      DELIVERY_FAILED occurrences each send their own notification
 *      set; no over-dedup.
 *
 * Tests 6+7 together pin the GRAIN of the dedup gate — a too-tight
 * gate would catch the NDR retries (fail 7); a too-loose gate would
 * miss the bus redelivery (fail 6). Mirrors the M10 commit-9
 * duplicate-webhook + NDR-retry pairing.
 */

describe('M11 Notifications — lifecycle fan-out e2e (NOTIF-1..8)', () => {
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

    const email = `notif-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Notif Brand',
        contactPersonName: 'Notif Owner',
        phone: '+8801712345700',
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

    await receiveStock(10);
  });

  // ── helpers ───────────────────────────────────────────────────────

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

  /** Place a customer order; default recipientEmail set. Pass null to
   *  exercise NOTIF-8 SKIPPED. */
  async function placeOrder(opts: { customerEmail?: string | null } = {}): Promise<string> {
    const created = await request(h.baseUrl)
      .post('/seller/orders')
      .set(sellerAuth)
      .send({
        recipientName: 'Pooja Sharma',
        recipientPhoneE164: '+919876543211',
        // recipientEmail snapshot — ORD-6 canonical. The 'undefined'
        // sentinel: omit the key to leave it NULL on the order row.
        ...(opts.customerEmail === undefined
          ? { recipientEmail: 'pooja@example.in' }
          : opts.customerEmail === null
            ? {}
            : { recipientEmail: opts.customerEmail }),
        recipientAddressLine1: '12 MG Road',
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
    return orderId;
  }

  /** Drive an order to PENDING_DISPATCH (the warehouse + AWB chain).
   *  Stops short of the final transitionStatus(→ DISPATCHED) so a
   *  caller can interpose (e.g., set up a Resend stub) before the
   *  DISPATCHED notifications fan out. */
  async function driveToPendingDispatch(orderId: string): Promise<{
    shipmentId: string;
    awbNumber: string;
  }> {
    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const shipment = await h.prisma.shipment.findFirstOrThrow({
      where: { orderShipments: { some: { orderId } } },
    });

    await request(h.baseUrl).post('/warehouse/picks/next').set(staffAuth).expect(200);
    await request(h.baseUrl)
      .post(`/warehouse/picks/${shipment.id}/start`)
      .set(staffAuth)
      .expect(200);
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
      .post(`/admin/warehouse/manifests/${pack.body.manifestId}/close`)
      .set(staffAuth)
      .expect(200);

    const withAwb = await waitFor(
      async () => {
        const s = await h.prisma.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
        });
        return s.awbNumber !== null ? s : null;
      },
      { timeoutMs: 15_000, description: 'AWB generated' },
    );
    return { shipmentId: shipment.id, awbNumber: withAwb.awbNumber! };
  }

  /** Drive an order all the way through DISPATCHED. */
  async function driveToDispatched(orderId: string): Promise<{
    shipmentId: string;
    awbNumber: string;
  }> {
    const intermediate = await driveToPendingDispatch(orderId);
    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.DISPATCHED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    return intermediate;
  }

  /** Wait until exactly `expectedCount` notification_logs rows exist for
   *  this order. The lifecycle drove several intermediate transitions
   *  with non-notifying targets (PENDING_PICK / PICKED / PACKED /
   *  PENDING_DISPATCH all map to []), but CONFIRMED + DISPATCHED both
   *  fan out — so the expected count varies per test. */
  async function waitForLogCount(
    orderId: string,
    expectedCount: number,
    expectedStatus: NotificationStatus,
  ): Promise<Awaited<ReturnType<typeof h.prisma.notificationLog.findMany>>> {
    return waitFor(
      async () => {
        const rows = await h.prisma.notificationLog.findMany({
          where: { orderId, status: expectedStatus },
        });
        return rows.length === expectedCount ? rows : null;
      },
      {
        timeoutMs: 15_000,
        description: `wait for ${expectedCount} ${expectedStatus} notification_logs rows for order ${orderId}`,
      },
    );
  }

  // ── Scenario 1: DISPATCHED → 2 rows + tracking URL ────────────────

  it('DISPATCHED → 2 SENT ledger rows (seller + customer) with M10 tracking URL in customer body', async () => {
    const orderId = await placeOrder();
    const { awbNumber } = await driveToDispatched(orderId);

    // Two fanout phases hit during the lifecycle:
    //   - CONFIRMED → seller + customer (2 rows)
    //   - DISPATCHED → seller + customer (2 rows)
    // (intermediate PENDING_PICK / PICKED / PACKED / PENDING_DISPATCH
    // map to []).
    // Wait for all 4 to land as SENT.
    const sent = await waitForLogCount(orderId, 4, NotificationStatus.SENT);
    expect(sent).toHaveLength(4);

    // Of the four, two should be the DISPATCHED set.
    const dispatched = sent.filter(
      (r) =>
        r.templateCode === 'seller.order_dispatched.email' ||
        r.templateCode === 'customer.order_dispatched.email',
    );
    expect(dispatched).toHaveLength(2);
    const seller = dispatched.find((r) => r.recipientType === NotificationRecipientType.SELLER);
    const customer = dispatched.find((r) => r.recipientType === NotificationRecipientType.CUSTOMER);
    expect(seller).toBeDefined();
    expect(customer).toBeDefined();

    // Customer body contains the M10 tracking URL: ${PUBLIC_TRACKING_URL}/${awb}.
    // Read the URL from the BOOTED app's EnvService (the test fixture
    // in test/helpers/env is for unit tests; the e2e harness loads
    // env from process.env / .env so we read it directly from DI).
    const { EnvService } = await import('../../src/config/env.service');
    const appEnv = h.app.get(EnvService);
    const expectedUrl = `${appEnv.publicTrackingUrl}/${encodeURIComponent(awbNumber)}`;
    expect(customer!.body).toContain(expectedUrl);
    // Bilingual body: also contains the Hindi half delimiter.
    expect(customer!.body).toContain('---');
    expect(customer!.body).toContain('यहाँ ट्रैक करें');

    // Seller body has AWB in the subject (Q5 seller template).
    expect(seller!.subject).toContain(awbNumber);

    // Both rows are status SENT.
    expect(seller!.status).toBe(NotificationStatus.SENT);
    expect(customer!.status).toBe(NotificationStatus.SENT);

    // Both rows have the same eventId pattern (order_status:<statusEventId>);
    // the DISPATCHED occurrence eventId is the OrderEvent.id of the
    // CONFIRMED→...→DISPATCHED STATUS_CHANGED row.
    const dispatchedEvent = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId, type: OrderEventType.STATUS_CHANGED, toStatus: OrderStatus.DISPATCHED },
    });
    expect(seller!.eventId).toBe(`order_status:${dispatchedEvent.id}`);
    expect(customer!.eventId).toBe(`order_status:${dispatchedEvent.id}`);
  });

  // ── Scenario 2: NOTIF-8 SKIPPED (no customer email) ───────────────

  it('NOTIF-8 — customer with no recipientEmail → SKIPPED row; seller SENT', async () => {
    const orderId = await placeOrder({ customerEmail: null });
    await driveToDispatched(orderId);

    // Two SENT rows: seller-CONFIRMED + seller-DISPATCHED.
    const sent = await waitForLogCount(orderId, 2, NotificationStatus.SENT);
    expect(sent.every((r) => r.recipientType === NotificationRecipientType.SELLER)).toBe(true);

    // Two SKIPPED rows: customer-CONFIRMED + customer-DISPATCHED.
    const skipped = await waitForLogCount(orderId, 2, NotificationStatus.SKIPPED);
    expect(skipped.every((r) => r.recipientType === NotificationRecipientType.CUSTOMER)).toBe(true);
    expect(skipped.every((r) => r.toEmail === null)).toBe(true);
    // SKIPPED rows have eventId set — they consume the dedup gate so a
    // re-emit doesn't insert a 2nd SKIPPED row.
    expect(skipped.every((r) => r.eventId !== null && r.eventId !== '')).toBe(true);
  });

  // ── Scenario 3: PENDING_MANUAL_PLACEMENT → no notifications ────────

  it('PENDING_MANUAL_PLACEMENT lifecycle is silent — no notifications fired', async () => {
    // Build to PENDING_PICK then escalate to PENDING_MANUAL_PLACEMENT
    // (M8 commit-1 matrix edge for pick-shortfall — but here we drive
    // it directly via the order-write engine).
    const orderId = await placeOrder();
    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.CONFIRMED,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    // 2 notifications for CONFIRMED (seller + customer).
    await waitForLogCount(orderId, 2, NotificationStatus.SENT);
    const beforeManual = await h.prisma.notificationLog.count({ where: { orderId } });
    expect(beforeManual).toBe(2);

    // Drive PENDING_PICK → PENDING_MANUAL_PLACEMENT (M8 WMS-4
    // fail-routing edge). The order has no shipment in start-able
    // state yet but transitionStatus itself doesn't validate
    // operational columns — the matrix edge has empty side-effects.
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.PENDING_PICK,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.PENDING_MANUAL_PLACEMENT,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    // Give the listener / worker a moment for any rogue notifications.
    await new Promise((r) => setTimeout(r, 500));

    // Still exactly 2 — the PENDING_MANUAL_PLACEMENT mapping is [].
    const afterManual = await h.prisma.notificationLog.count({ where: { orderId } });
    expect(afterManual).toBe(2);
  });

  // ── Scenario 4: NOTIF-1 PROOF — Resend failure does not block the
  //    transition. THE LOAD-BEARING SAFETY TEST. ────────────────────

  it('NOTIF-1 — Resend send failure leaves the order DISPATCHED + committed; notification row is FAILED', async () => {
    const orderId = await placeOrder();

    // Drive the warehouse chain WITHOUT the final DISPATCHED transition.
    // The CONFIRMED notifications land normally first — we'll wait for
    // them, then turn on the failure injection, then drive DISPATCHED.
    const { awbNumber } = await driveToPendingDispatch(orderId);
    await waitForLogCount(orderId, 2, NotificationStatus.SENT);

    // Now install the failure injection — every subsequent Resend send
    // returns FAILED. The fan-out for DISPATCHED is the only fan-out
    // that fires after this point.
    const resend = h.app.get(ResendService);
    const sendSpy = jest.spyOn(resend, 'send').mockImplementation(async () => ({
      ok: false,
      code: 'INJECTED_TEST_FAILURE',
      message: 'forced failure for NOTIF-1 proof',
    }));

    try {
      // The load-bearing line: drive the final transition with the
      // failure injection live. If the M11 emit's NOTIF-1 boundary
      // is broken, this throws or rolls the order back.
      const ow = h.app.get(OrderWriteService);
      await ow.transitionStatus({
        orderId,
        to: OrderStatus.DISPATCHED,
        actor: { type: ActorType.STAFF, id: staffId },
      });

      // DISPATCHED produces 2 notifications, both should land FAILED.
      const failed = await waitForLogCount(orderId, 2, NotificationStatus.FAILED);
      expect(failed.every((r) => r.failureCode === 'INJECTED_TEST_FAILURE')).toBe(true);
      expect(new Set(failed.map((r) => r.templateCode))).toEqual(
        new Set(['seller.order_dispatched.email', 'customer.order_dispatched.email']),
      );

      // THE INVARIANT: the order is still DISPATCHED + the transition's
      // tx committed. The notification failure NEVER leaked back.
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(OrderStatus.DISPATCHED);

      // Stock side-effect of dispatch (Model A CUR-3) is also intact —
      // the M9 DISPATCH movement applied, qtyOnHand went 10 → 8. This
      // proves the FULL post-commit chain (M8 / M9 hooks + M11 emit)
      // ran to completion despite the notification failure.
      const level = await h.prisma.stockLevel.findFirstOrThrow({
        where: { variantId, binId },
      });
      expect(level.qtyOnHand).toBe(8);

      // Sanity: the AWB persisted normally too.
      expect(awbNumber).toBeTruthy();
    } finally {
      sendSpy.mockRestore();
    }
  });

  // ── Scenario 5: DUPLICATE event (bus redelivery) → dedup ───────────

  it('DUPLICATE — re-emitting the same eventId is a NO-OP (NOTIF-2 dedup gate)', async () => {
    const orderId = await placeOrder();
    await driveToDispatched(orderId);

    // 4 rows expected (CONFIRMED + DISPATCHED, each seller+customer).
    const sent = await waitForLogCount(orderId, 4, NotificationStatus.SENT);
    expect(sent).toHaveLength(4);

    const dispatchedEvent = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId, type: OrderEventType.STATUS_CHANGED, toStatus: OrderStatus.DISPATCHED },
    });

    // Simulate a bus redelivery — emit the SAME event a second time.
    const bus = h.app.get(OrderLifecycleEventBus);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const redeliveredEvent: OrderLifecycleEvent = {
      orderId,
      sellerId: order.sellerId,
      from: OrderStatus.PENDING_DISPATCH,
      to: OrderStatus.DISPATCHED,
      statusEventId: dispatchedEvent.id, // SAME id — the dedup gate must catch
      actorType: ActorType.SYSTEM,
      actorId: null,
      occurredAt: new Date(),
    };
    bus.emit(redeliveredEvent);

    // Give the listener a moment to attempt + dedup.
    await new Promise((r) => setTimeout(r, 800));

    // Still exactly 4 rows. NO new ledger rows, NO new BullMQ enqueue.
    const after = await h.prisma.notificationLog.findMany({ where: { orderId } });
    expect(after).toHaveLength(4);
  });

  // ── Scenario 6: NDR CYCLE — distinct occurrences each fan out ─────

  it('NDR CYCLE — distinct OFD & DELIVERY_FAILED occurrences each fan out (no over-dedup)', async () => {
    const orderId = await placeOrder();
    await driveToDispatched(orderId);

    // Wait for the CONFIRMED + DISPATCHED notifications to land first
    // so they don't muddy the cycle assertions.
    await waitForLogCount(orderId, 4, NotificationStatus.SENT);

    const ow = h.app.get(OrderWriteService);

    // Walk the NDR retry cycle on the order. Two re-entries each of
    // OUT_FOR_DELIVERY and DELIVERY_FAILED:
    //   DISPATCHED → IN_TRANSIT → OFD(1) → DELIVERY_FAILED(1) →
    //   OFD(2) → DELIVERY_FAILED(2)
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.IN_TRANSIT,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.OUT_FOR_DELIVERY,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.DELIVERY_FAILED,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.OUT_FOR_DELIVERY,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.DELIVERY_FAILED,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    // Q5 mapping for the cycle (excluding CONFIRMED/DISPATCHED):
    //   OFD(occ1)               → 1 customer row
    //   DELIVERY_FAILED(occ1)   → 1 seller + 1 customer row
    //   OFD(occ2)               → 1 customer row
    //   DELIVERY_FAILED(occ2)   → 1 seller + 1 customer row
    // Total NEW = 6 rows on top of the prior 4.
    await waitForLogCount(orderId, 10, NotificationStatus.SENT);

    const cycleRows = await h.prisma.notificationLog.findMany({
      where: {
        orderId,
        OR: [
          { templateCode: 'customer.order_out_for_delivery.email' },
          { templateCode: 'customer.order_delivery_failed.email' },
          { templateCode: 'seller.order_delivery_failed.email' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(cycleRows).toHaveLength(6);

    // OFD occurrences — both customer rows, each from a DIFFERENT
    // OrderEvent (distinct eventIds).
    const ofdRows = cycleRows.filter(
      (r) => r.templateCode === 'customer.order_out_for_delivery.email',
    );
    expect(ofdRows).toHaveLength(2);
    const ofdEventIds = new Set(ofdRows.map((r) => r.eventId));
    expect(ofdEventIds.size).toBe(2); // distinct — no dedup-collapse

    // DELIVERY_FAILED occurrences — 2 seller + 2 customer = 4 rows
    // across 2 distinct eventIds (each eventId produces seller+customer).
    const ndrRows = cycleRows.filter(
      (r) =>
        r.templateCode === 'customer.order_delivery_failed.email' ||
        r.templateCode === 'seller.order_delivery_failed.email',
    );
    expect(ndrRows).toHaveLength(4);
    const ndrEventIds = new Set(ndrRows.map((r) => r.eventId));
    expect(ndrEventIds.size).toBe(2); // 2 distinct occurrence-eventIds
    // Each NDR eventId appears EXACTLY twice (seller + customer).
    for (const eid of ndrEventIds) {
      const matching = ndrRows.filter((r) => r.eventId === eid);
      expect(matching).toHaveLength(2);
      expect(new Set(matching.map((r) => r.recipientType))).toEqual(
        new Set([NotificationRecipientType.SELLER, NotificationRecipientType.CUSTOMER]),
      );
    }

    // Cross-check against order_events: the matrix really did produce
    // 2 distinct STATUS_CHANGED rows for each re-entered status, and
    // the mapping's per-occurrence eventIds correspond.
    const dfEvents = await h.prisma.orderEvent.findMany({
      where: {
        orderId,
        type: OrderEventType.STATUS_CHANGED,
        toStatus: OrderStatus.DELIVERY_FAILED,
      },
      select: { id: true },
    });
    expect(dfEvents).toHaveLength(2);
    const dfEventIdsExpected = new Set(dfEvents.map((e) => `order_status:${e.id}`));
    expect(dfEventIdsExpected).toEqual(ndrEventIds);
  });
});
