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

function event(status: ShipmentStatus, over: Record<string, unknown> = {}) {
  return {
    eventAt: new Date('2026-10-28T11:04:00.000Z'),
    status,
    rawCourierStatus: null,
    courierCode: 'delhivery',
    shipment: { awbNumber: '38061110571491', courierCode: 'delhivery' },
    ...over,
  };
}

function makeService(opts: { events?: unknown[]; checks?: unknown[]; live?: boolean } = {}) {
  const update = jest.fn(async () => ({}));
  const prisma = {
    client: {
      addressCheck: { findMany: jest.fn(async () => opts.checks ?? [CHECK]), update },
      trackingEvent: { findMany: jest.fn(async () => opts.events ?? []) },
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

  it('the courier’s own words go in ndr_reasons, and only for an NDR', async () => {
    const { svc, feedback } = makeService({
      events: [
        event(ShipmentStatus.DELIVERY_ATTEMPTED, { rawCourierStatus: 'Customer not available' }),
      ],
    });
    await svc.sweep();
    expect(feedback).toHaveBeenCalledWith(
      expect.objectContaining({ ndrReasons: ['Customer not available'] }),
    );
  });

  it('a delivered scan carries no ndr_reasons even when the courier said something', async () => {
    const { svc, feedback } = makeService({
      events: [event(ShipmentStatus.DELIVERED, { rawCourierStatus: 'Left with neighbour' })],
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
