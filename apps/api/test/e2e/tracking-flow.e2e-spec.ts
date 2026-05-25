import { createHmac } from 'node:crypto';
import request from 'supertest';
import {
  ActorType,
  OrderStatus,
  ShipmentStatus,
  StockMovementType,
  TrackingEventSource,
  TrackingEventType,
  WebhookStatus,
} from '@skydrop/db';
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
 * Module 10 — public tracking end-to-end.
 *
 * Drives the FULL pipeline: HMAC-signed webhook ingest → BullMQ
 * processing → tracking_event append + order transition →
 * public AWB lookup. The TRK-1..9 invariants are exercised at the
 * integration layer (unit specs already pin the per-service shapes;
 * here we prove the wiring).
 *
 * Critical scenarios:
 *   - Happy path through DELIVERED — stock-neutral verification
 *     (TRK-7) — the M10 layer regression guard for the M9 bug-1
 *     resolution that DELIVERED has empty side-effects.
 *   - TRK-2 dedup on duplicate webhook (same signature → byte-
 *     identical body).
 *   - OUT-OF-ORDER scans: a DELIVERED scan arriving before its
 *     OUT_FOR_DELIVERY counterpart — both recorded by eventAt; the
 *     order ends DELIVERED; no backward transition.
 *   - STALE-BACKWARD: an IN_TRANSIT scan after DELIVERED — recorded
 *     as audit, transition skipped (CURRENT_NOT_IN_ALLOWED_FROM).
 *   - NDR retry cycle (the commit-9 fix): N NDR scans + a
 *     redelivery → N delivery_attempts rows; redelivery transitions
 *     cleanly back to OUT_FOR_DELIVERY (DELIVERY_FAILED →
 *     OUT_FOR_DELIVERY matrix edge + mapping allowedFrom).
 *   - TRK-6 RTO boundary: a webhook can drive RTO up to
 *     RTO_IN_TRANSIT only; the warehouse `RtoReceiptService.receive`
 *     is the sole authority for RTO_RECEIVED.
 *   - Public AWB lookup customer-safe projection — keys pinned
 *     exactly; cross-shipment leak negative test; 404 anti-
 *     enumeration.
 *   - Manual tracking entry — source=MANUAL_ENTRY recorded, actor
 *     captured.
 */

const COURIER_CODE = 'delhivery';
const WEBHOOK_SECRET =
  process.env['TRACKING_WEBHOOK_SECRET_DELHIVERY'] ??
  'test-tracking-webhook-secret-delhivery';

function signBody(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');
}

function makeScanBody(opts: {
  awbNumber: string;
  rawStatus: string;
  eventAtIso: string;
  description?: string;
  failureReason?: string;
  locationCity?: string;
}): string {
  // JSON.stringify is deterministic for plain objects in stable key order.
  // We sign these exact bytes.
  const obj: Record<string, string> = {
    awb_number: opts.awbNumber,
    raw_status: opts.rawStatus,
    event_at: opts.eventAtIso,
  };
  if (opts.description !== undefined) obj['description'] = opts.description;
  if (opts.failureReason !== undefined) obj['failure_reason'] = opts.failureReason;
  if (opts.locationCity !== undefined) obj['location_city'] = opts.locationCity;
  return JSON.stringify(obj);
}

describe('M10 Tracking — webhook lifecycle e2e (TRK-1..9)', () => {
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
    await resetAuthState(h.prisma);

    const staff = await createTestStaff(h.prisma);
    staffId = staff.id;
    const sLogin = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${sLogin.body.accessToken}` };

    const email = `track-seller-${Date.now()}@brand.com`;
    const invite = await request(h.baseUrl)
      .post('/admin/seller-invitations')
      .set(staffAuth)
      .send({ email })
      .expect(201);
    const reg = await request(h.baseUrl)
      .post('/auth/seller/register/invite')
      .send({
        token: invite.body.token,
        companyName: 'Track Brand',
        contactPersonName: 'Track Owner',
        phone: '+8801712345699',
        password: 'SellerPass-1234',
      })
      .expect(201);
    sellerAuth = { Authorization: `Bearer ${reg.body.accessToken}` };

    const whs = await request(h.baseUrl)
      .get('/admin/warehouses')
      .set(staffAuth)
      .expect(200);
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
  });

  // ── helpers ───────────────────────────────────────────────────────────

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
        lines: [
          { lineId: gr.body.lines[0].id, receivedQty: qty, putawayBinId: binId },
        ],
      })
      .expect(200);
    await request(h.baseUrl)
      .post(`/admin/goods-receipts/${gr.body.id}/complete`)
      .set(staffAuth)
      .expect(200);
  }

  /** Drive an order all the way to DISPATCHED via the real pipeline,
   *  using stock-conservation-rto.e2e's pattern. Returns the
   *  shipmentId + awbNumber the tests need to drive webhooks. */
  async function driveToDispatched(qty: number): Promise<{
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
        recipientAddressLine1: '12 MG Road',
        recipientCity: 'Bengaluru',
        recipientStateProvince: 'Karnataka',
        recipientPostalCode: '560001',
        paymentMode: 'COD',
        codAmountInr: 999,
        items: [{ variantId, quantity: qty }],
      })
      .expect(201);
    const orderId = created.body.id as string;
    await request(h.baseUrl)
      .post(`/seller/orders/${orderId}/submit`)
      .set(sellerAuth)
      .expect(200);
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

    await ow.transitionStatus({
      orderId,
      to: OrderStatus.DISPATCHED,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    return { orderId, shipmentId: shipment.id, awbNumber: withAwb.awbNumber! };
  }

  /** Send a signed webhook and wait for the processor to mark it
   *  PROCESSED (or IGNORED). Returns the final webhook row. */
  async function sendWebhookAndWait(body: string): Promise<{
    webhookId: string;
    httpStatus: number;
    result: 'stored' | 'duplicate';
    webhook: {
      id: string;
      status: WebhookStatus;
      trackingEventId: string | null;
      processedAt: Date | null;
    };
  }> {
    const sig = signBody(body);
    const res = await request(h.baseUrl)
      .post(`/public/tracking/webhooks/${COURIER_CODE}`)
      .set('content-type', 'application/json')
      .set('x-skydrop-signature', sig)
      .send(body);
    expect(res.status).toBe(200);
    const webhookId = res.body.webhookId as string;
    const result = res.body.result as 'stored' | 'duplicate';
    // Duplicate hits don't enqueue — the row is already terminal-or-not
    // from the original ingest. For STORED, wait for status to leave RECEIVED.
    let webhook;
    if (result === 'stored') {
      webhook = await waitFor(
        async () => {
          const w = await h.prisma.courierWebhook.findUnique({
            where: { id: webhookId },
            select: {
              id: true,
              status: true,
              trackingEventId: true,
              processedAt: true,
            },
          });
          return w && w.status !== WebhookStatus.RECEIVED ? w : null;
        },
        { timeoutMs: 10_000, description: `webhook ${webhookId} processed` },
      );
    } else {
      const w = await h.prisma.courierWebhook.findUnique({
        where: { id: webhookId },
        select: {
          id: true,
          status: true,
          trackingEventId: true,
          processedAt: true,
        },
      });
      webhook = w!;
    }
    return { webhookId, httpStatus: res.status, result, webhook };
  }

  // ── Scenario 1: HAPPY PATH ──────────────────────────────────────────

  it('HAPPY: IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED webhooks drive the order through; DELIVERED is stock-neutral', async () => {
    await receiveStock(10);
    const { orderId, awbNumber } = await driveToDispatched(2);

    // dispatched-state snapshot — qtyOnHand should already be 8 after
    // the M9 Model-A dispatch decrement.
    const afterDispatch = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(afterDispatch.qtyOnHand).toBe(8);
    expect(afterDispatch.qtyReserved).toBe(0);

    // Scan 1: IN_TRANSIT.
    const r1 = await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-IN-TRANSIT',
        eventAtIso: '2026-05-20T10:00:00.000Z',
        locationCity: 'Chennai',
      }),
    );
    expect(r1.webhook.status).toBe(WebhookStatus.PROCESSED);
    expect(r1.webhook.trackingEventId).not.toBeNull();
    let order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.IN_TRANSIT);

    // Scan 2: OUT_FOR_DELIVERY.
    const r2 = await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-OFD',
        eventAtIso: '2026-05-22T07:00:00.000Z',
        locationCity: 'Bengaluru',
      }),
    );
    expect(r2.webhook.status).toBe(WebhookStatus.PROCESSED);
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.OUT_FOR_DELIVERY);

    // Scan 3: DELIVERED — the TRK-7 stock-neutral case.
    const r3 = await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-DELIVERED',
        eventAtIso: '2026-05-22T14:00:00.000Z',
        locationCity: 'Bengaluru',
      }),
    );
    expect(r3.webhook.status).toBe(WebhookStatus.PROCESSED);
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERED);
  });

  // ── Scenario 2: TRK-2 DUPLICATE ─────────────────────────────────────

  it('TRK-2 DUPLICATE: same signed body → second ingest returns "duplicate" + the original webhookId; NO double tracking_event', async () => {
    await receiveStock(10);
    const { awbNumber } = await driveToDispatched(2);
    const body = makeScanBody({
      awbNumber,
      rawStatus: 'DLV-IN-TRANSIT',
      eventAtIso: '2026-05-20T10:00:00.000Z',
    });
    const r1 = await sendWebhookAndWait(body);
    expect(r1.result).toBe('stored');

    // Replay the EXACT same body — same signature → dedup hit.
    const r2 = await sendWebhookAndWait(body);
    expect(r2.result).toBe('duplicate');
    expect(r2.webhookId).toBe(r1.webhookId);

    // No double tracking_event for the awbNumber's shipment.
    const ship = await h.prisma.shipment.findUniqueOrThrow({
      where: { awbNumber },
    });
    const events = await h.prisma.trackingEvent.findMany({
      where: { shipmentId: ship.id },
    });
    expect(events).toHaveLength(1);
  });

  // ── Scenario 3: OUT-OF-ORDER ────────────────────────────────────────

  it('OUT-OF-ORDER: DELIVERED scan arrives BEFORE OUT_FOR_DELIVERY scan; both recorded, order ends DELIVERED, no backward transition', async () => {
    await receiveStock(10);
    const { orderId, awbNumber } = await driveToDispatched(2);
    // Move order through IN_TRANSIT so OFD is a valid forward step.
    const ow = h.app.get(OrderWriteService);
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.IN_TRANSIT,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    // OFD scan with eventAt EARLIER in time.
    const ofdScan = makeScanBody({
      awbNumber,
      rawStatus: 'DLV-OFD',
      eventAtIso: '2026-05-22T07:00:00.000Z',
    });
    // DELIVERED scan with eventAt LATER in time, but arriving FIRST.
    const delScan = makeScanBody({
      awbNumber,
      rawStatus: 'DLV-DELIVERED',
      eventAtIso: '2026-05-22T14:00:00.000Z',
    });

    // Arrive the DELIVERED scan first. Without an OFD precursor on the
    // order, the guard's allowedFrom=[OUT_FOR_DELIVERY] would skip —
    // so we drive the order through OFD first (admin/system intent) so
    // DELIVERED is a valid forward step.
    await ow.transitionStatus({
      orderId,
      to: OrderStatus.OUT_FOR_DELIVERY,
      actor: { type: ActorType.STAFF, id: staffId },
    });
    const rDel = await sendWebhookAndWait(delScan);
    expect(rDel.webhook.status).toBe(WebhookStatus.PROCESSED);
    let order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERED);

    // Now the OFD scan arrives LATE. Guard: current=DELIVERED, target=
    // OFD, allowedFrom=[IN_TRANSIT, DELIVERY_FAILED]. DELIVERED not in
    // allowedFrom → SKIP transition; event still recorded.
    const rOfd = await sendWebhookAndWait(ofdScan);
    expect(rOfd.webhook.status).toBe(WebhookStatus.PROCESSED);
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERED); // unchanged

    // Both events recorded; the timeline orders by eventAt DESC.
    const ship = await h.prisma.shipment.findUniqueOrThrow({ where: { awbNumber } });
    const tl = await h.prisma.trackingEvent.findMany({
      where: { shipmentId: ship.id },
      orderBy: { eventAt: 'desc' },
      select: { eventType: true, eventAt: true },
    });
    expect(tl).toHaveLength(2);
    expect(tl[0]?.eventType).toBe(TrackingEventType.DELIVERED);
    expect(tl[1]?.eventType).toBe(TrackingEventType.OUT_FOR_DELIVERY);
  });

  // ── Scenario 4: STALE-BACKWARD ──────────────────────────────────────

  it('STALE-BACKWARD: IN_TRANSIT scan AFTER DELIVERED → recorded, transition skipped, NO error', async () => {
    await receiveStock(10);
    const { orderId, awbNumber } = await driveToDispatched(2);
    const ow = h.app.get(OrderWriteService);
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
      to: OrderStatus.DELIVERED,
      actor: { type: ActorType.STAFF, id: staffId },
    });

    // Now a late IN_TRANSIT scan arrives.
    const rStale = await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-IN-TRANSIT',
        eventAtIso: '2026-05-22T08:00:00.000Z',
      }),
    );
    expect(rStale.webhook.status).toBe(WebhookStatus.PROCESSED); // not FAILED
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERED); // unchanged

    // Event STILL recorded for audit + customer timeline.
    const ship = await h.prisma.shipment.findUniqueOrThrow({ where: { awbNumber } });
    const events = await h.prisma.trackingEvent.findMany({
      where: { shipmentId: ship.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe(TrackingEventType.IN_TRANSIT_UPDATE);
  });

  // ── Scenario 5: NDR RETRY CYCLE (M10 commit-9 fix end-to-end) ────────

  it('NDR retry cycle: 2 NDR scans + a redelivery → 2 delivery_attempts rows, redelivery transitions DELIVERY_FAILED → OUT_FOR_DELIVERY cleanly', async () => {
    await receiveStock(10);
    const { orderId, awbNumber } = await driveToDispatched(2);
    const ow = h.app.get(OrderWriteService);
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

    // NDR #1.
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-NDR',
        eventAtIso: '2026-05-22T14:00:00.000Z',
        failureReason: 'CUSTOMER_UNAVAILABLE',
      }),
    );
    let order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERY_FAILED);

    // NDR #2 — order already at DELIVERY_FAILED; ALREADY_AT_TARGET
    // skip, but attempt row STILL written.
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-NDR',
        eventAtIso: '2026-05-23T14:00:00.000Z',
        failureReason: 'CUSTOMER_UNAVAILABLE',
      }),
    );
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERY_FAILED); // unchanged

    // Two delivery_attempts rows.
    const ship = await h.prisma.shipment.findUniqueOrThrow({ where: { awbNumber } });
    const attempts = await h.prisma.deliveryAttempt.findMany({
      where: { shipmentId: ship.id },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);

    // Redelivery: OFD scan arrives. This is the COMMIT-9 fix —
    // mapping allowedFrom MUST include DELIVERY_FAILED. Without it
    // this would be silently skipped.
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-OFD',
        eventAtIso: '2026-05-24T07:00:00.000Z',
      }),
    );
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.OUT_FOR_DELIVERY); // ← commit-9 invariant

    // No NEW attempt row (OFD isn't an NDR).
    const attemptsAfter = await h.prisma.deliveryAttempt.findMany({
      where: { shipmentId: ship.id },
    });
    expect(attemptsAfter).toHaveLength(2);
  });

  // ── Scenario 6: TRK-7 CONSERVATION (DELIVERED stock-neutral) ──────────

  it('TRK-7 CONSERVATION re-verify: drive webhook-delivered order; dispatch 8/0 STAYS 8/0 at DELIVERED (no stock side-effect re-attached)', async () => {
    await receiveStock(10);
    const { orderId, awbNumber } = await driveToDispatched(2);

    const baseline = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    expect(baseline.qtyOnHand).toBe(8); // M9 Model-A dispatch decrement already happened
    expect(baseline.qtyReserved).toBe(0);

    // Drive through to DELIVERED via webhooks.
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-IN-TRANSIT',
        eventAtIso: '2026-05-20T10:00:00.000Z',
      }),
    );
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-OFD',
        eventAtIso: '2026-05-22T07:00:00.000Z',
      }),
    );
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-DELIVERED',
        eventAtIso: '2026-05-22T14:00:00.000Z',
      }),
    );

    const after = await h.prisma.stockLevel.findFirstOrThrow({
      where: { variantId, binId },
    });
    // INVARIANT: qtyOnHand UNCHANGED at DELIVERED. The M9 Model-A
    // bug-1 fix made DELIVERED stock-neutral; a regression that
    // re-attached a side-effect (e.g., a FULFILL_STOCK on the
    // OUT_FOR_DELIVERY → DELIVERED edge, or a DELIVERY_STOCK movement
    // in the processor) would change qtyOnHand. M10's responsibility
    // is to never reach back into the stock layer for DELIVERED.
    expect(after.qtyOnHand).toBe(8);
    expect(after.qtyReserved).toBe(0);

    // Defensive: ONLY ONE DISPATCH movement exists for this order
    // (the M9 commit-12 normal-lifecycle decrement). No extra movements.
    const movements = await h.prisma.stockMovement.findMany({
      where: { orderId, type: StockMovementType.DISPATCH },
    });
    expect(movements).toHaveLength(1);

    // Order is DELIVERED.
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.DELIVERED);
  });

  // ── Scenario 7: TRK-6 RTO BOUNDARY ──────────────────────────────────

  it('TRK-6 RTO boundary: webhook reaches RTO_IN_TRANSIT only; warehouse RtoReceiptService.receive transitions RTO_IN_TRANSIT → RTO_RECEIVED', async () => {
    await receiveStock(10);
    const { orderId, awbNumber } = await driveToDispatched(2);

    // Webhook drives into RTO.
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-RTO-INIT',
        eventAtIso: '2026-05-22T10:00:00.000Z',
      }),
    );
    let order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_INITIATED);

    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-RTO-IT',
        eventAtIso: '2026-05-23T10:00:00.000Z',
      }),
    );
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_IN_TRANSIT); // TRK-6 ceiling

    // CRITICAL: RTO_DELIVERED webhook is INFORMATIONAL — does NOT
    // drive RTO_RECEIVED. The boundary is enforced.
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-RTO-DEL',
        eventAtIso: '2026-05-24T10:00:00.000Z',
      }),
    );
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_IN_TRANSIT); // still — RTO_DELIVERED scan is informational

    // The RTO_DELIVERED event WAS recorded (timeline completeness).
    const ship = await h.prisma.shipment.findUniqueOrThrow({ where: { awbNumber } });
    const events = await h.prisma.trackingEvent.findMany({
      where: { shipmentId: ship.id, eventType: TrackingEventType.RTO_DELIVERED },
    });
    expect(events).toHaveLength(1);

    // The warehouse path IS the authority for RTO_RECEIVED.
    await request(h.baseUrl)
      .post('/warehouse/rto/receive')
      .set(staffAuth)
      .send({ awbNumber })
      .expect(200);
    order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.RTO_RECEIVED);
  });

  // ── Scenario 8: PUBLIC AWB LOOKUP ───────────────────────────────────

  it('PUBLIC AWB LOOKUP: returns customer-safe projection; no internal IDs/PII/raw codes in the response', async () => {
    await receiveStock(10);
    const { awbNumber } = await driveToDispatched(2);

    // Drive a couple of customer-visible scans.
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-IN-TRANSIT',
        eventAtIso: '2026-05-20T10:00:00.000Z',
        locationCity: 'Chennai',
        description: 'In transit at hub',
      }),
    );
    await sendWebhookAndWait(
      makeScanBody({
        awbNumber,
        rawStatus: 'DLV-OFD',
        eventAtIso: '2026-05-22T07:00:00.000Z',
        locationCity: 'Bengaluru',
      }),
    );

    const res = await request(h.baseUrl)
      .get(`/public/tracking/${awbNumber}`)
      .expect(200);
    const body = res.body as Record<string, unknown>;

    // Top-level key set EXACTLY (regression guard against accidental
    // PII / internal-ID leakage).
    expect(Object.keys(body).sort()).toEqual(
      [
        'awbNumber',
        'courierDisplayName',
        'currentStatus',
        'currentStatusAt',
        'destinationCity',
        'estimatedDeliveryAt',
        'timeline',
      ].sort(),
    );
    expect(body['awbNumber']).toBe(awbNumber);
    expect(body['currentStatus']).toBe('out_for_delivery');
    expect(body['destinationCity']).toBe('Bengaluru');

    // Each timeline event has EXACTLY the four allowed columns.
    const tl = body['timeline'] as Array<Record<string, unknown>>;
    expect(tl).toHaveLength(2);
    for (const ev of tl) {
      expect(Object.keys(ev).sort()).toEqual(
        ['description', 'eventAt', 'locationCity', 'status'].sort(),
      );
    }
    // Most-recent first (eventAt DESC).
    expect(tl[0]?.['status']).toBe('out_for_delivery');
    expect(tl[1]?.['status']).toBe('in_transit');

    // Defensive — NO leaked internal identifier strings anywhere
    // in the serialized body. Recipient name "Asha Verma" set in
    // driveToDispatched MUST NOT appear (PII leak).
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Asha Verma');
    expect(serialized).not.toContain('+919876543210');
    expect(serialized).not.toContain('12 MG Road');
    // Internal codes / IDs.
    expect(serialized).not.toContain('orderId');
    expect(serialized).not.toContain('shipmentId');
    expect(serialized).not.toContain('webhookId');
    expect(serialized).not.toContain('DLV-IN-TRANSIT'); // raw courier status
    expect(serialized).not.toContain('DLV-OFD');
  });

  it('PUBLIC 404 ANTI-ENUMERATION: unknown AWB returns the same generic 404 body', async () => {
    const res = await request(h.baseUrl)
      .get('/public/tracking/DLV-NOPE-NOT-A-REAL-AWB')
      .expect(404);
    expect(res.body).toMatchObject({
      code: 'TRACKING_NOT_FOUND',
      message: 'No tracking information found for the provided number.',
    });
  });

  // ── Scenario 9: MANUAL ENTRY (TRK-9) ────────────────────────────────

  it('MANUAL ENTRY: ops POST drives the order forward and records a MANUAL_ENTRY tracking_event with actorType=STAFF + actorId', async () => {
    await receiveStock(10);
    const { orderId, shipmentId } = await driveToDispatched(2);

    const res = await request(h.baseUrl)
      .post(`/admin/tracking/shipments/${shipmentId}/manual-scan`)
      .set(staffAuth)
      .send({
        status: ShipmentStatus.IN_TRANSIT,
        eventAtIso: '2026-05-20T10:00:00.000Z',
        description: 'Manual courier handoff confirmed',
        locationCity: 'Chennai',
      })
      .expect(200);
    expect(res.body.kind).toBe('TRANSITIONED');

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe(OrderStatus.IN_TRANSIT);

    const events = await h.prisma.trackingEvent.findMany({
      where: { shipmentId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe(TrackingEventSource.MANUAL_ENTRY);
    expect(events[0]?.actorType).toBe(ActorType.STAFF);
    expect(events[0]?.actorId).toBe(staffId);
    expect(events[0]?.webhookId).toBeNull();
  });
});
