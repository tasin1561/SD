import request from 'supertest';
import {
  ActorType,
  NotificationChannel,
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
  claimPick,
  resetAuthState,
  waitFor,
  type AppHarness,
  packAtBench,
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
        // Fixture: several orders for one customer on purpose.
        acknowledgeDuplicate: true,
        // recipientEmail snapshot — ORD-6 canonical. The 'undefined'
        // sentinel: omit the key to leave it NULL on the order row.
        ...(opts.customerEmail === undefined
          ? { recipientEmail: 'pooja@example.in' }
          : opts.customerEmail === null
            ? {}
            : { recipientEmail: opts.customerEmail }),
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

    // The AWB is generated at confirmation on a BullMQ job, and while
    // it runs it holds a row lock the pick's SKIP LOCKED pull skips
    // past — so a pull issued microseconds later can hand back a
    // different parcel. Correct in production; a test needs the
    // specific one. See claimPick.
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

    const pack = await packAtBench(h.baseUrl, staffAuth, h.prisma, shipment.id);
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
          // EMAIL only. Every seller fan-out now also writes an IN_APP
          // row (NOTIF-9..13) — the same notification on a second
          // channel — and this suite is about the email leg. Counting
          // both would make every expected number here a sum of two
          // unrelated decisions.
          where: { orderId, status: expectedStatus, channel: NotificationChannel.EMAIL },
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

  it('DISPATCHED → the CUSTOMER’s email, with the M10 tracking URL in its body', async () => {
    const orderId = await placeOrder();
    const { awbNumber } = await driveToDispatched(orderId);

    // Two fanout phases hit during the lifecycle, and since 2026-09-20
    // each leaves ONE email:
    //   - CONFIRMED  → customer (the seller's leg is retired)
    //   - DISPATCHED → customer (likewise)
    // (intermediate PENDING_PICK / PICKED / PACKED / PENDING_DISPATCH
    // map to []).
    //
    // The seller still hears about both — in their INBOX, which the
    // scenario further down asserts. `RETIRED_EMAIL_TEMPLATES` withholds
    // the duplicate before a row is written, which is why the count
    // here halved rather than the rows turning up SKIPPED.
    const sent = await waitForLogCount(orderId, 2, NotificationStatus.SENT);
    expect(sent).toHaveLength(2);
    expect(sent.every((r) => r.recipientType === NotificationRecipientType.CUSTOMER)).toBe(true);

    const dispatched = sent.filter((r) => r.templateCode === 'customer.order_dispatched.email');
    expect(dispatched).toHaveLength(1);
    const customer = dispatched[0];
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

    expect(customer!.status).toBe(NotificationStatus.SENT);

    // The eventId is `order_status:<statusEventId>` — the OrderEvent.id
    // of the CONFIRMED→…→DISPATCHED STATUS_CHANGED row.
    const dispatchedEvent = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId, type: OrderEventType.STATUS_CHANGED, toStatus: OrderStatus.DISPATCHED },
    });
    expect(customer!.eventId).toBe(`order_status:${dispatchedEvent.id}`);

    // The seller heard about the same dispatch in their INBOX, keyed on
    // the SAME lifecycle event with the `:inapp` suffix the two legs are
    // deliberately kept distinct by. The AWB-in-the-subject assertion
    // that used to sit here went with the seller's email leg: an inbox
    // line has no subject, and its body is one sentence by design.
    const sellerInbox = await waitFor(
      async () =>
        h.prisma.notificationLog.findFirst({
          where: {
            orderId,
            channel: NotificationChannel.IN_APP,
            templateCode: 'seller.order_dispatched',
          },
        }),
      { timeoutMs: 15_000, description: 'the seller’s in-app dispatch line' },
    );
    expect(sellerInbox.eventId).toBe(`order_status:${dispatchedEvent.id}:inapp`);
  });

  // ── Scenario 2: NOTIF-8 SKIPPED (no customer email) ───────────────

  it('NOTIF-8 — customer with no recipientEmail → SKIPPED row; seller SENT', async () => {
    const orderId = await placeOrder({ customerEmail: null });
    await driveToDispatched(orderId);

    // Two SKIPPED rows: customer-CONFIRMED + customer-DISPATCHED.
    const skipped = await waitForLogCount(orderId, 2, NotificationStatus.SKIPPED);
    expect(skipped.every((r) => r.recipientType === NotificationRecipientType.CUSTOMER)).toBe(true);
    expect(skipped.every((r) => r.toEmail === null)).toBe(true);
    // SKIPPED rows have eventId set — they consume the dedup gate so a
    // re-emit doesn't insert a 2nd SKIPPED row.
    expect(skipped.every((r) => r.eventId !== null && r.eventId !== '')).toBe(true);

    // And NO sent email at all. Both seller legs are retired, and the
    // customer — the only remaining email recipient on this order — has
    // no address, so the whole email channel is silent here. Asserted
    // AFTER the SKIPPED rows have landed, because a count of zero is
    // true before anything has happened and would pass on an empty table.
    const sent = await h.prisma.notificationLog.count({
      where: { orderId, status: NotificationStatus.SENT, channel: NotificationChannel.EMAIL },
    });
    expect(sent).toBe(0);
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

    // ONE email for CONFIRMED — the customer's. The seller's leg is
    // retired in favour of their inbox.
    await waitForLogCount(orderId, 1, NotificationStatus.SENT);
    const beforeManual = await h.prisma.notificationLog.count({
      where: { orderId, channel: NotificationChannel.EMAIL },
    });
    expect(beforeManual).toBe(1);

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

    // Still exactly 1 — the PENDING_MANUAL_PLACEMENT mapping is [].
    const afterManual = await h.prisma.notificationLog.count({
      where: { orderId, channel: NotificationChannel.EMAIL },
    });
    expect(afterManual).toBe(1);
  });

  // ── Scenario 4: NOTIF-1 PROOF — Resend failure does not block the
  //    transition. THE LOAD-BEARING SAFETY TEST. ────────────────────

  it('NOTIF-1 — Resend send failure leaves the order DISPATCHED + committed; notification row is FAILED', async () => {
    const orderId = await placeOrder();

    // Drive the warehouse chain WITHOUT the final DISPATCHED transition.
    // The CONFIRMED notifications land normally first — we'll wait for
    // them, then turn on the failure injection, then drive DISPATCHED.
    const { awbNumber } = await driveToPendingDispatch(orderId);
    await waitForLogCount(orderId, 1, NotificationStatus.SENT);

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

      // DISPATCHED produces ONE email now — the customer's — and it
      // should land FAILED. The seller's leg is retired, so the proof
      // rests on the customer's; what is being tested is that a send
      // failure never reaches back into the transition, and one failing
      // row demonstrates that exactly as two did.
      const failed = await waitForLogCount(orderId, 1, NotificationStatus.FAILED);
      expect(failed.every((r) => r.failureCode === 'INJECTED_TEST_FAILURE')).toBe(true);
      expect(new Set(failed.map((r) => r.templateCode))).toEqual(
        new Set(['customer.order_dispatched.email']),
      );

      // THE INVARIANT: the order is still DISPATCHED + the transition's
      // tx committed. The notification failure NEVER leaked back.
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(OrderStatus.DISPATCHED);

      // The stock side-effect (CUR-3) is also intact — the PACK_CONFIRM
      // movement applied when the box was packed (Model C, 2026-09-03),
      // qtyOnHand went 10 → 8, and DISPATCHED itself moved nothing
      // further. This proves the FULL post-commit chain (M8 / M9 hooks
      // + M11 emit) ran to completion despite the notification failure.
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

    // 2 rows expected — CONFIRMED and DISPATCHED, customer only.
    const sent = await waitForLogCount(orderId, 2, NotificationStatus.SENT);
    expect(sent).toHaveLength(2);

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

    // Still exactly 2 rows. NO new ledger rows, NO new BullMQ enqueue.
    const after = await h.prisma.notificationLog.findMany({
      where: { orderId, channel: NotificationChannel.EMAIL },
    });
    expect(after).toHaveLength(2);
  });

  // ── Scenario 6: NDR CYCLE — distinct occurrences each fan out ─────

  it('NDR CYCLE — distinct OFD & DELIVERY_FAILED occurrences each fan out (no over-dedup)', async () => {
    const orderId = await placeOrder();
    await driveToDispatched(orderId);

    // Wait for the CONFIRMED + DISPATCHED notifications to land first
    // so they don't muddy the cycle assertions.
    await waitForLogCount(orderId, 2, NotificationStatus.SENT);

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

    // Q5 mapping for the cycle (excluding CONFIRMED/DISPATCHED). The
    // seller's DELIVERY_FAILED email is retired, so every row here is
    // the customer's:
    //   OFD(occ1)               → 1 customer row
    //   DELIVERY_FAILED(occ1)   → 1 customer row
    //   OFD(occ2)               → 1 customer row
    //   DELIVERY_FAILED(occ2)   → 1 customer row
    // Total NEW = 4 rows on top of the prior 2.
    await waitForLogCount(orderId, 6, NotificationStatus.SENT);

    const cycleRows = await h.prisma.notificationLog.findMany({
      where: {
        orderId,
        channel: NotificationChannel.EMAIL,
        OR: [
          { templateCode: 'customer.order_out_for_delivery.email' },
          { templateCode: 'customer.order_delivery_failed.email' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(cycleRows).toHaveLength(4);

    // OFD occurrences — both customer rows, each from a DIFFERENT
    // OrderEvent (distinct eventIds).
    const ofdRows = cycleRows.filter(
      (r) => r.templateCode === 'customer.order_out_for_delivery.email',
    );
    expect(ofdRows).toHaveLength(2);
    const ofdEventIds = new Set(ofdRows.map((r) => r.eventId));
    expect(ofdEventIds.size).toBe(2); // distinct — no dedup-collapse

    // DELIVERY_FAILED occurrences — 2 customer rows across 2 distinct
    // eventIds. THE POINT OF THIS TEST IS THE EVENT IDS, not the
    // recipients: two genuine re-entries of one status must not collapse
    // into a single notification through the NOTIF-2 dedup gate. That
    // property is untouched by the seller's leg being retired.
    const ndrRows = cycleRows.filter(
      (r) => r.templateCode === 'customer.order_delivery_failed.email',
    );
    expect(ndrRows).toHaveLength(2);
    const ndrEventIds = new Set(ndrRows.map((r) => r.eventId));
    expect(ndrEventIds.size).toBe(2); // 2 distinct occurrence-eventIds
    // Each NDR eventId appears EXACTLY once now — the customer's.
    for (const eid of ndrEventIds) {
      const matching = ndrRows.filter((r) => r.eventId === eid);
      expect(matching).toHaveLength(1);
      expect(matching[0]?.recipientType).toBe(NotificationRecipientType.CUSTOMER);
    }

    // The seller heard about each failure too — in their inbox, which
    // is the whole reason the email was retired. Two in-app rows, one
    // per occurrence, on the same two event ids.
    const ndrInbox = await h.prisma.notificationLog.findMany({
      where: {
        orderId,
        channel: NotificationChannel.IN_APP,
        templateCode: 'seller.order_delivery_failed',
      },
    });
    expect(ndrInbox).toHaveLength(2);
    expect(new Set(ndrInbox.map((r) => r.eventId?.replace(/:inapp$/, '')))).toEqual(ndrEventIds);

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

  // ── Scenario 8: the SECOND channel (NOTIF-9..13) ──────────────────

  it('the same lifecycle event also lands in the seller’s own inbox', async () => {
    const orderId = await placeOrder();
    await driveToDispatched(orderId);
    await waitForLogCount(orderId, 2, NotificationStatus.SENT);

    const owner = await h.prisma.sellerUser.findFirstOrThrow({
      where: { seller: { email: { contains: 'notif-seller-' } } },
      select: { id: true },
    });

    const inbox = await waitFor(
      async () => {
        const rows = await h.prisma.notificationLog.findMany({
          where: { orderId, channel: NotificationChannel.IN_APP },
          orderBy: { createdAt: 'asc' },
        });
        return rows.length === 2 ? rows : null;
      },
      { timeoutMs: 15_000, description: 'two IN_APP rows (CONFIRMED + DISPATCHED)' },
    );

    // CONFIRMED and DISPATCHED both carry an in-app leg; the two
    // intermediate statuses map to [] and neither leg fires.
    expect(inbox.map((r) => r.templateCode)).toEqual([
      'order.confirmed.seller',
      'seller.order_dispatched',
    ]);

    // Addressed to the PERSON, not the company — an inbox belongs to
    // somebody, and the seller row is a company.
    for (const row of inbox) {
      expect(row.toInAppUserId).toBe(owner.id);
      expect(row.toEmail).toBeNull();
      // The IN_APP row IS the delivery: there is no worker behind it,
      // so leaving it QUEUED would show an unread nobody marks sent.
      expect(row.status).toBe(NotificationStatus.SENT);
      expect(row.sentAt).not.toBeNull();
      expect(row.readAt).toBeNull();
    }

    // The order number is in the body, not a placeholder.
    const order = await h.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { orderNumber: true },
    });
    expect(inbox[1]?.body).toContain(order.orderNumber);
    expect(inbox[1]?.body).not.toContain('{orderNumber}');

    // And the seller can read them through their own endpoint.
    const feed = await request(h.baseUrl).get('/seller/notifications').set(sellerAuth).expect(200);
    expect(feed.body.unreadCount).toBe(2);
  });

  it('a person who silences the topic stops getting it — and reaches no further than their own inbox', async () => {
    await request(h.baseUrl)
      .post('/seller/notifications/subscriptions')
      .set(sellerAuth)
      .send({ topic: 'seller.order_dispatched', mode: 'MUTED' })
      .expect(200);

    const orderId = await placeOrder();
    await driveToDispatched(orderId);
    // This asserted "and still gets the email" until 2026-09-20, when
    // the seller's own dispatch email was retired — there is no longer
    // a second leg of THEIR notification for a mute to leave alone.
    //
    // The property worth keeping is the one that remains observable and
    // is the more important half anyway: a person's choice about their
    // own inbox must not reach the CUSTOMER's mail. Both customer
    // emails land, untouched.
    const sent = await waitForLogCount(orderId, 2, NotificationStatus.SENT);
    expect(sent.every((r) => r.recipientType === NotificationRecipientType.CUSTOMER)).toBe(true);

    await new Promise((r) => setTimeout(r, 800));
    const inbox = await h.prisma.notificationLog.findMany({
      where: { orderId, channel: NotificationChannel.IN_APP },
    });
    // CONFIRMED still arrives; only DISPATCHED was silenced.
    expect(inbox.map((r) => r.templateCode)).toEqual(['order.confirmed.seller']);
  });

  // ── Scenario 9: the company's own per-category preferences ────────

  it('a category the company switched off stops both legs — and the customer still hears', async () => {
    // These rows had a screen and no reader on the send path until
    // now: a seller could switch a category off, watch it save, and
    // keep getting every email. This is that gate, end to end.
    await request(h.baseUrl)
      .patch('/seller/notification-preferences/SHIPMENT_UPDATES')
      .set(sellerAuth)
      .send({ emailEnabled: false, inAppEnabled: false })
      .expect(200);

    const orderId = await placeOrder();
    await driveToDispatched(orderId);

    // Both customer emails still land. Since 2026-09-20 neither seller
    // leg is an email at all, so what the company's switch is observed
    // to stop is the INBOX line below — and what it must NOT stop is
    // either of these.
    const sent = await waitForLogCount(orderId, 2, NotificationStatus.SENT);
    const codes = sent.map((r) => r.templateCode).sort();
    expect(codes).toEqual(['customer.order_confirmed.email', 'customer.order_dispatched.email']);

    // A seller must not be able to silence the emails their own
    // customers rely on — they are not the company's to switch off.
    await new Promise((r) => setTimeout(r, 800));
    const inbox = await h.prisma.notificationLog.findMany({
      where: { orderId, channel: NotificationChannel.IN_APP },
    });
    expect(inbox.map((r) => r.templateCode)).toEqual(['order.confirmed.seller']);
  });
});
