import { OrderAttentionService } from '../../src/modules/order-attention/services/order-attention.service';

/**
 * NSA day counting.
 *
 * The arithmetic is the whole feature: get it wrong and either nobody is
 * told about a stuck parcel, or everybody is told about a healthy one at
 * six every evening until it delivers.
 *
 * All times below are written as UTC instants with their India-time
 * meaning in the comment, because that is the timezone the cutoff is an
 * hour of — the servers are not in it and neither is the seller.
 */
const evenings = OrderAttentionService.evenings;
const CUTOFF = 18; // 6pm IST

describe('OrderAttentionService.evenings', () => {
  it('is zero before the first cutoff has passed', () => {
    // Out at 10:00 IST, asked at 17:00 IST the same day. The van is
    // still out; nothing is wrong yet.
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST
    const now = new Date('2026-09-01T11:30:00Z'); // 17:00 IST
    expect(evenings(out, now, CUTOFF)).toBe(0);
  });

  it('is one at the cutoff on the day it went out', () => {
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST
    const now = new Date('2026-09-01T12:30:00Z'); // 18:00 IST exactly
    expect(evenings(out, now, CUTOFF)).toBe(1);
  });

  it('reaches two and three on the following evenings', () => {
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST, 1 Sep
    expect(evenings(out, new Date('2026-09-02T13:00:00Z'), CUTOFF)).toBe(2); // 18:30 IST, 2 Sep
    expect(evenings(out, new Date('2026-09-03T13:00:00Z'), CUTOFF)).toBe(3); // 18:30 IST, 3 Sep
  });

  it('does not tick over at midnight — the next DAY still waits for its cutoff', () => {
    // The trap: counting elapsed hours would make a parcel that went out
    // at 23:00 "day 2" seven hours later, at 6am, with nobody having had
    // a chance to deliver it.
    const out = new Date('2026-09-01T17:30:00Z'); // 23:00 IST, 1 Sep
    expect(evenings(out, new Date('2026-09-02T04:30:00Z'), CUTOFF)).toBe(1); // 10:00 IST, 2 Sep
    expect(evenings(out, new Date('2026-09-02T13:00:00Z'), CUTOFF)).toBe(2); // 18:30 IST, 2 Sep
  });

  it('counts in INDIA time, not the server’s', () => {
    // 19:00 UTC on 1 Sep is already 00:30 IST on 2 Sep. A server reading
    // its own clock would call this the first evening; in Delhi it is
    // the small hours of the next day and the cutoff has passed once.
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST, 1 Sep
    const now = new Date('2026-09-01T19:00:00Z'); // 00:30 IST, 2 Sep
    expect(evenings(out, now, CUTOFF)).toBe(1);
  });

  it('never goes negative for a scan dated in the future', () => {
    // Courier clocks drift and scans arrive with their own timestamps.
    const out = new Date('2026-09-05T04:30:00Z');
    const now = new Date('2026-09-01T13:00:00Z');
    expect(evenings(out, now, CUTOFF)).toBe(0);
  });

  it('honours a different cutoff hour', () => {
    const out = new Date('2026-09-01T04:30:00Z'); // 10:00 IST
    const now = new Date('2026-09-01T10:00:00Z'); // 15:30 IST
    expect(evenings(out, now, 18)).toBe(0);
    expect(evenings(out, now, 15)).toBe(1);
  });
});

describe('OrderAttentionService.dayPhrase', () => {
  // Reached through the notification variables; the phrase is what the
  // seller actually reads in the subject line.
  const phrase = (OrderAttentionService as unknown as { dayPhrase: (d: number) => string })
    .dayPhrase;

  it('says it the way a person would', () => {
    expect(phrase(1)).toBe('since yesterday');
    expect(phrase(2)).toBe('for 2 days now');
    expect(phrase(3)).toBe('for 3 days now');
  });
});

// ---------------------------------------------------------------------
// The stalled-waybill check.
//
// SD-2026-26-000003 is the case this exists for: confirmed, stock
// reserved, a shipment, and no waybill — because the AWB is booked once,
// on ENTRY to CONFIRMED, and the order was already past that moment.
// Nothing asked again and nothing said so. It had not failed; it had
// stopped, and the only symptom was its absence from a list.
// ---------------------------------------------------------------------
describe('OrderAttentionService — a confirmed order with no waybill', () => {
  const ORDER = 'ord-1';
  const SHIP = 'ship-1';

  function makeService(opts: {
    /** What the shipment looks like AFTER the retry ran. */
    afterRetry?: { awbNumber: string | null; supersededAt: Date | null };
    /** What the order's status is AFTER the retry ran. */
    orderAfter?: string;
  }) {
    const processOrder = jest.fn(async () => ({ result: 'ERROR' }));
    const raise = jest.fn(async () => undefined);
    const resolveByKey = jest.fn(async () => undefined);

    const client = {
      systemSetting: {
        // The NSA half OFF, so the sweep short-circuits after the two
        // unconditional checks — this one is deliberately not gated
        // behind that switch, which is the property being exercised.
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
          where.key === 'ops.nsa_enabled' ? { valueBoolean: false } : null,
        ),
      },
      orderShipment: {
        findMany: jest.fn(async () => [
          {
            orderId: ORDER,
            shipmentId: SHIP,
            order: { orderNumber: 'SD-2026-26-000003', sellerId: 'sel-1' },
          },
        ]),
      },
      order: {
        findUnique: jest.fn(async () => ({ status: opts.orderAfter ?? 'CONFIRMED' })),
        findMany: jest.fn(async () => []),
      },
      shipment: {
        findUnique: jest.fn(async () => opts.afterRetry ?? { awbNumber: null, supersededAt: null }),
      },
      orderDeliveryActionRequest: { findMany: jest.fn(async () => []) },
    };

    const svc = new OrderAttentionService(
      { client } as never,
      { log: jest.fn() } as never,
      {} as never,
      {} as never,
      { raise, resolveByKey } as never,
      { processOrder } as never,
    );
    return { svc, processOrder, raise, resolveByKey };
  }

  it('asks the courier again BEFORE raising anything', async () => {
    const { svc, processOrder } = makeService({});
    await svc.sweep(new Date('2026-09-02T12:00:00Z'));

    // The retry is the fix for the common case, and it is what delivers
    // the refusal routing (CUR-13/14) to an order that is already past
    // the moment it would otherwise have happened.
    expect(processOrder).toHaveBeenCalledWith(ORDER);
  });

  it('raises a HIGH issue when the retry did not get a waybill either', async () => {
    const { svc, raise, resolveByKey } = makeService({});
    const summary = await svc.sweep(new Date('2026-09-02T12:00:00Z'));

    expect(summary.awbless).toBe(1);
    expect(resolveByKey).not.toHaveBeenCalled();
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'HIGH',
        dedupeKey: `awb-stalled:${ORDER}`,
        title: expect.stringContaining('SD-2026-26-000003'),
      }),
    );
  });

  it('resolves instead of raising when the retry got a waybill', async () => {
    const { svc, raise, resolveByKey } = makeService({
      afterRetry: { awbNumber: 'DL123', supersededAt: null },
    });
    const summary = await svc.sweep(new Date('2026-09-02T12:00:00Z'));

    expect(summary.awbless).toBe(0);
    expect(raise).not.toHaveBeenCalled();
    expect(resolveByKey).toHaveBeenCalledWith(`awb-stalled:${ORDER}`, expect.any(String));
  });

  it('resolves when the refusal routed the order to manual placement', async () => {
    // The courier refused, so the order moved OUT of CONFIRMED and the
    // shipment was superseded (CUR-7). That is a success for this check:
    // the order is somebody's job now, and it is on the manual placement
    // queue rather than sitting silently.
    const { svc, raise, resolveByKey } = makeService({
      orderAfter: 'PENDING_MANUAL_PLACEMENT',
      afterRetry: { awbNumber: null, supersededAt: new Date() },
    });
    const summary = await svc.sweep(new Date('2026-09-02T12:00:00Z'));

    expect(summary.awbless).toBe(0);
    expect(raise).not.toHaveBeenCalled();
    expect(resolveByKey).toHaveBeenCalled();
  });

  it('a courier that throws still leaves the order flagged, not skipped', async () => {
    const { svc, raise } = makeService({});
    (svc as unknown as { awbJob: { processOrder: jest.Mock } }).awbJob.processOrder = jest.fn(
      async () => {
        throw new Error('socket hang up');
      },
    );
    const summary = await svc.sweep(new Date('2026-09-02T12:00:00Z'));

    expect(summary.awbless).toBe(1);
    expect(raise).toHaveBeenCalled();
  });
});
