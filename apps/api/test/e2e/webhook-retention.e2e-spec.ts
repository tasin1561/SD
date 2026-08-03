import { WebhookPayloadRetentionService } from '../../src/modules/tracking-ingestion/services/webhook-payload-retention.service';
import { bootTestApp, flushTestRedis, resetAuthState, type AppHarness } from './app-harness';

/**
 * Bounding the largest table per order.
 *
 * `courier_webhooks` stores the courier's payload up to three times per
 * scan and nothing ever removed it, so its size was a function of how
 * long the company had existed rather than of anything operational.
 *
 * The properties that matter are all about what is NOT lost: the row
 * survives as evidence, `tracking_events` is untouched, and rows inside
 * the window keep their payload. A test that only checked "space was
 * reclaimed" would pass for an implementation that deleted the lot.
 */
describe('Courier payload retention (e2e)', () => {
  let h: AppHarness;
  let svc: WebhookPayloadRetentionService;

  const OLD = new Date(Date.now() - 200 * 864e5);
  const RECENT = new Date(Date.now() - 3 * 864e5);
  const BODY = '{"scan":"delivered","awb":"TEST123","padding":"' + 'x'.repeat(500) + '"}';

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);
    svc = h.app.get(WebhookPayloadRetentionService);
  });

  async function makeWebhook(receivedAt: Date, awb: string): Promise<string> {
    const row = await h.prisma.courierWebhook.create({
      data: {
        courierCode: 'delhivery',
        awbNumber: awb,
        receivedAt,
        httpMethod: 'POST',
        endpoint: '/public/tracking/webhooks/delhivery',
        headers: { 'x-signature': 'abc', 'content-type': 'application/json' },
        rawBody: BODY,
        parsedBody: { scan: 'delivered', awb },
        signature: 'abc',
        signatureValid: true,
        status: 'PROCESSED',
      },
      select: { id: true },
    });
    return row.id;
  }

  it('clears payloads past the window and keeps the evidence', async () => {
    const oldId = await makeWebhook(OLD, 'OLD-1');

    const result = await svc.sweep();
    expect(result.rowsCleared).toBe(1);

    const row = await h.prisma.courierWebhook.findUniqueOrThrow({ where: { id: oldId } });
    // The artefact is gone…
    expect(row.rawBody).toBe('');
    expect(row.parsedBody).toBeNull();
    expect(row.headers).toEqual({});
    // …and the evidence is not. That a scan arrived, that its signature
    // verified, and which AWB it was, all survive.
    expect(row.awbNumber).toBe('OLD-1');
    expect(row.signatureValid).toBe(true);
    expect(row.status).toBe('PROCESSED');
    expect(row.receivedAt).toBeInstanceOf(Date);
  });

  it('leaves rows inside the window completely alone', async () => {
    const recentId = await makeWebhook(RECENT, 'NEW-1');

    await svc.sweep();

    const row = await h.prisma.courierWebhook.findUniqueOrThrow({ where: { id: recentId } });
    expect(row.rawBody).toBe(BODY);
    expect(row.parsedBody).not.toBeNull();
  });

  it('is idempotent — a second run clears nothing and rewrites nothing', async () => {
    await makeWebhook(OLD, 'OLD-2');

    const first = await svc.sweep();
    expect(first.rowsCleared).toBe(1);

    // The `rawBody: { not: '' }` filter is what makes this true; without
    // it every sweep would rewrite the whole history of the table.
    const second = await svc.sweep();
    expect(second.rowsCleared).toBe(0);
  });

  it('never touches the customer-visible scan timeline', async () => {
    // tracking_events is the permanent record the public tracking page
    // renders. The webhook is only how it arrived.
    const before = await h.prisma.trackingEvent.count();
    await makeWebhook(OLD, 'OLD-3');
    await svc.sweep();
    expect(await h.prisma.trackingEvent.count()).toBe(before);
  });

  it('reports how much is still held, so the sweep is visible', async () => {
    await makeWebhook(RECENT, 'NEW-2');
    await makeWebhook(OLD, 'OLD-4');

    const before = await svc.pendingCount();
    expect(before.retained).toBe(2);
    expect(before.retentionDays).toBe(90);

    await svc.sweep();
    const after = await svc.pendingCount();
    expect(after.retained).toBe(1);
  });

  it('honours a shortened retention window from settings', async () => {
    await makeWebhook(RECENT, 'NEW-3');
    await h.prisma.systemSetting.update({
      where: { key: 'tracking.webhook_payload_retention_days' },
      data: { valueInt: 1 },
    });

    const result = await svc.sweep();
    expect(result.retentionDays).toBe(1);
    expect(result.rowsCleared).toBe(1);
  });
});
