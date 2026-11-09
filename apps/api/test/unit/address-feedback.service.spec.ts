import { ShipmentStatus } from '@skydrop/db';
import { AddressFeedbackService } from '../../src/modules/address-check/services/address-feedback.service';
import type {
  FeedbackInput,
  SolustationHttpService,
} from '../../src/modules/address-check/services/solustation-http.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const CHECK = {
  id: 'ac-1',
  orderId: 'o-1',
  validationId: 'val_1',
  feedbackWatermarkAt: null as Date | null,
};

const SCAN_AT = new Date('2026-10-28T11:04:00.000Z');

function event(status: ShipmentStatus, over: Record<string, unknown> = {}) {
  return {
    eventAt: SCAN_AT,
    status,
    courierCode: 'delhivery',
    // The join to the courier's remark: a webhook-sourced scan matches
    // its attempt by `webhookId`, a poll-sourced one by shipment + time.
    shipmentId: 's-1',
    webhookId: null,
    shipment: { awbNumber: '38061110571491', courierCode: 'delhivery' },
    ...over,
  };
}

/**
 * A `delivery_attempts` row — where `failure_notes` actually lives.
 *
 * The remark is NOT on the scan; these two tables are written by the
 * same saga and joined after the fact, so a fake that omits this model
 * makes every NDR look like a courier that said nothing.
 */
function attempt(over: Record<string, unknown> = {}) {
  return {
    shipmentId: 's-1',
    webhookId: null,
    attemptedAt: SCAN_AT,
    failureNotes: 'Address incomplete',
    ...over,
  };
}

function makeService(
  opts: { events?: unknown[]; checks?: unknown[]; live?: boolean; attempts?: unknown[] } = {},
) {
  const update = jest.fn(async () => ({}));
  const prisma = {
    client: {
      addressCheck: { findMany: jest.fn(async () => opts.checks ?? [CHECK]), update },
      trackingEvent: { findMany: jest.fn(async () => opts.events ?? []) },
      deliveryAttempt: { findMany: jest.fn(async () => opts.attempts ?? []) },
    },
  } as unknown as PrismaService;
  // Typed args so `mock.calls[0][0]` is readable — a bare
  // `jest.fn(async () => …)` makes the call tuple empty.
  const feedback = jest.fn(async (_input: FeedbackInput) => undefined);
  const http = {
    isLive: jest.fn(async () => opts.live ?? true),
    feedback,
  } as unknown as SolustationHttpService;
  return { svc: new AddressFeedbackService(prisma, http), feedback, update };
}

describe('AddressFeedbackService — the mapping is a training signal', () => {
  /*
    A wrong label here teaches their phase-5 model something false about
    an address, and nothing downstream would ever show that it had. So
    the table is asserted value by value rather than spot-checked.
  */
  it.each([
    [ShipmentStatus.HANDED_TO_COURIER, 'in_transit'],
    [ShipmentStatus.IN_TRANSIT, 'in_transit'],
    [ShipmentStatus.AT_HUB, 'in_transit'],
    [ShipmentStatus.OUT_FOR_DELIVERY, 'in_transit'],
    [ShipmentStatus.DELIVERY_ATTEMPTED, 'ndr'],
    [ShipmentStatus.DELIVERED, 'delivered'],
    [ShipmentStatus.RTO_INITIATED, 'rto'],
    [ShipmentStatus.RTO_IN_TRANSIT, 'rto'],
    [ShipmentStatus.RTO_DELIVERED, 'rto'],
    [ShipmentStatus.LOST, 'lost'],
    [ShipmentStatus.DAMAGED, 'lost'],
    [ShipmentStatus.CANCELLED, 'cancelled'],
  ])('%s is reported as %s', async (status, expected) => {
    const { svc, feedback } = makeService({ events: [event(status)] });
    await svc.sweep();
    expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ status: expected }));
  });

  it.each([
    ShipmentStatus.CREATED,
    ShipmentStatus.AWB_PENDING,
    ShipmentStatus.AWB_GENERATED,
    ShipmentStatus.FAILED_AT_CREATION,
  ])('%s reports NOTHING — a printed label is not a journey', async (status) => {
    // Sending one would teach the model that an address "went in
    // transit" when no van ever moved.
    const { svc, feedback } = makeService({ events: [event(status)] });
    await svc.sweep();
    expect(feedback).not.toHaveBeenCalled();
  });

  /*
    ── THE REMARK, NOT THE STATUS ───────────────────────────────────────
    `ndr_reasons` is the one free-text signal a failed delivery carries,
    and for a while it was being fed the STATUS string — which already
    travels in `status`, so their model received the same word twice and
    never learned why the parcel bounced. These four tests pin the
    corrected contract from both ends.
  */
  it('ndr_reasons carries the courier’s remark from delivery_attempts', async () => {
    const { svc, feedback } = makeService({
      events: [event(ShipmentStatus.DELIVERY_ATTEMPTED, { webhookId: 'wh-1' })],
      attempts: [attempt({ webhookId: 'wh-1', failureNotes: 'Customer not available' })],
    });
    await svc.sweep();
    expect(feedback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ndr', ndrReasons: ['Customer not available'] }),
    );
  });

  it('a poll-sourced NDR, which has no webhook, matches on shipment and scan time', async () => {
    const { svc, feedback } = makeService({
      events: [event(ShipmentStatus.DELIVERY_ATTEMPTED)],
      attempts: [attempt({ failureNotes: 'Premises locked' })],
    });
    await svc.sweep();
    expect(feedback).toHaveBeenCalledWith(
      expect.objectContaining({ ndrReasons: ['Premises locked'] }),
    );
  });

  it('an NDR whose courier gave no remark sends an empty list, not nothing', async () => {
    // `[]` is a fact about the delivery — "it failed and nobody said
    // why". Dropping the field would make it indistinguishable from a
    // scan to which the question does not apply.
    const { svc, feedback } = makeService({
      events: [event(ShipmentStatus.DELIVERY_ATTEMPTED)],
      attempts: [],
    });
    await svc.sweep();
    expect(feedback).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ndr', ndrReasons: [] }),
    );
  });

  it('the status string never leaks into ndr_reasons', async () => {
    const { svc, feedback } = makeService({
      events: [event(ShipmentStatus.DELIVERY_ATTEMPTED)],
      attempts: [attempt({ failureNotes: 'Address incomplete' })],
    });
    await svc.sweep();
    const sent = feedback.mock.calls[0]?.[0];
    expect(sent?.ndrReasons).toEqual(['Address incomplete']);
    expect(sent?.ndrReasons).not.toContain('Undelivered');
    expect(sent?.ndrReasons).not.toContain(ShipmentStatus.DELIVERY_ATTEMPTED);
  });

  it('a delivered scan carries no ndr_reasons even when an attempt row exists', async () => {
    const { svc, feedback } = makeService({
      events: [event(ShipmentStatus.DELIVERED)],
      attempts: [attempt({ failureNotes: 'Left with neighbour' })],
    });
    await svc.sweep();
    expect(feedback.mock.calls[0]?.[0]).not.toHaveProperty('ndrReasons');
  });

  it('three RTO scans are three events, not one', async () => {
    // The journey back is part of what the model learns.
    const { svc, feedback } = makeService({
      events: [
        event(ShipmentStatus.RTO_INITIATED, { eventAt: new Date('2026-10-28T09:00:00Z') }),
        event(ShipmentStatus.RTO_IN_TRANSIT, { eventAt: new Date('2026-10-29T09:00:00Z') }),
        event(ShipmentStatus.RTO_DELIVERED, { eventAt: new Date('2026-10-30T09:00:00Z') }),
      ],
    });
    await svc.sweep();
    expect(feedback).toHaveBeenCalledTimes(3);
    expect(
      new Set(feedback.mock.calls.map((c) => (c[0] as { eventTime: string }).eventTime)).size,
    ).toBe(3);
  });
});

describe('AddressFeedbackService — the watermark', () => {
  it('moves past a scan it had nothing to say about', async () => {
    // Otherwise every sweep re-reads the same unreportable events for
    // ever and never reaches the ones behind them.
    const { svc, update, feedback } = makeService({
      events: [event(ShipmentStatus.AWB_GENERATED)],
    });
    await svc.sweep();
    expect(feedback).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { feedbackWatermarkAt: expect.any(Date) } }),
    );
  });

  it('does nothing at all when the integration is not configured', async () => {
    const { svc, feedback } = makeService({
      live: false,
      events: [event(ShipmentStatus.DELIVERED)],
    });
    expect(await svc.sweep()).toEqual({ checks: 0, sent: 0 });
    expect(feedback).not.toHaveBeenCalled();
  });

  it('one address failing does not stop the others', async () => {
    const { svc, feedback } = makeService({
      checks: [CHECK, { ...CHECK, id: 'ac-2', orderId: 'o-2' }],
      events: [event(ShipmentStatus.DELIVERED)],
    });
    (feedback as jest.Mock).mockRejectedValueOnce(new Error('their end is down'));
    const result = await svc.sweep();
    expect(result.checks).toBe(2);
    // The second one still went.
    expect(feedback).toHaveBeenCalledTimes(2);
  });
});
