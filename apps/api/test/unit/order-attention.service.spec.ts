import { OrderStateMachineService } from '../../src/modules/order/services/order-state-machine.service';
import { TrackingStatusMappingService } from '../../src/modules/tracking-events/services/tracking-status-mapping.service';
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
    /** How many of this order's shipments a courier has already
     *  refused and retired. At the cap we stop asking. */
    priorSupersedes?: number;
    /** What the shipment looks like AFTER the retry ran. */
    afterRetry?: { awbNumber: string | null; supersededAt: Date | null };
    /** What the order's status is AFTER the retry ran. */
    orderAfter?: string;
    /** Parcels for the stranded-tracking check: what the courier says
     *  vs what the order says. */
    stranded?: Array<{
      orderStatus: string;
      shipmentStatus: string;
      /** How many times the order has ALREADY been at the scan's
       *  target — >0 means the scan is stale and the skip is right. */
      timesAtTarget?: number;
    }>;
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
        // Two checks share this. Only the stranded-tracking one filters
        // on the shipment's own updatedAt, so that is what tells them
        // apart — a mock returning one shape to both would have the
        // second crashing on fields it never asked for.
        findMany: jest.fn(async (args: { where?: Record<string, unknown> }) => {
          const where = (args?.where ?? {}) as { shipment?: { updatedAt?: unknown } };
          if (where.shipment?.updatedAt !== undefined) {
            return (opts.stranded ?? []).map((r, i) => ({
              orderId: `${ORDER}-${i}`,
              shipmentId: `${SHIP}-${i}`,
              shipment: {
                status: r.shipmentStatus,
                shipmentNumber: `SH-${i}`,
                updatedAt: new Date('2026-09-01T00:00:00Z'),
              },
              order: {
                status: r.orderStatus,
                orderNumber: `SD-TEST-${i}`,
                sellerId: 'sel-1',
              },
            }));
          }
          return [
            {
              orderId: ORDER,
              shipmentId: SHIP,
              order: { orderNumber: 'SD-2026-26-000003', sellerId: 'sel-1' },
            },
          ];
        }),
        // How many times this order's shipments have already been
        // retired by a refusal — the retry cap reads this.
        count: jest.fn(async () => opts.priorSupersedes ?? 0),
        // The order's CURRENT live shipment. The settled check asks
        // this rather than the row it started with, because a refusal
        // retires that row and would otherwise read as success.
        findFirst: jest.fn(async () => ({
          shipment: { awbNumber: opts.afterRetry?.awbNumber ?? null },
        })),
      },
      orderEvent: {
        count: jest.fn(async () => opts.stranded?.[0]?.timesAtTarget ?? 0),
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
      // The real mapping: this watchdog asks it what the order SHOULD
      // be, and a fake would let the two drift apart silently — which
      // is the very failure it exists to catch.
      new TrackingStatusMappingService(),
      // Terminal-status lookup goes through the order facade; the real
      // state machine answers it, so a new terminal is covered here too.
      {
        isTerminalStatus: (st: never) => new OrderStateMachineService().isTerminal(st),
      } as never,
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

  describe('OrderAttentionService — a refusal is not a resolution', () => {
    const AT = new Date('2026-09-04T12:00:00Z');

    it('RAISES when the retry was refused, instead of closing itself', async () => {
      // The loop that hid itself: a refusal supersedes the shipment
      // this sweep was watching, and `supersededAt !== null` used to
      // count as settled — so every retry CLOSED the issue it should
      // have raised. SD-2026-26-000001 cycled like that every seven
      // hours for two days: refused, superseded, clock reset, refused
      // again, with nothing anywhere saying so.
      const { svc, raise, resolveByKey } = makeService({
        // No waybill on the live shipment after the retry: still stuck.
        afterRetry: { awbNumber: null, supersededAt: new Date() },
      });
      const summary = await svc.sweep(AT);
      expect(summary.awbless).toBe(1);
      expect(raise).toHaveBeenCalled();
      expect(resolveByKey).not.toHaveBeenCalledWith(
        expect.stringContaining('awb-stalled:'),
        expect.anything(),
      );
    });

    it('STOPS asking a courier that has refused three times', async () => {
      // A refusal is an opinion about the parcel and it will be the
      // same opinion tomorrow (CUR-13). Asking again is a real write
      // against a live account for nothing.
      const { svc, processOrder, raise } = makeService({
        priorSupersedes: 3,
        afterRetry: { awbNumber: null, supersededAt: new Date() },
      });
      await svc.sweep(AT);
      expect(processOrder).not.toHaveBeenCalled();
      expect(raise).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('refused this parcel 3 times'),
          metadata: expect.objectContaining({ refusals: 3, retriesExhausted: true }),
        }),
      );
    });

    it('still asks while there is reason to think it was a wobble', async () => {
      const { svc, processOrder } = makeService({
        priorSupersedes: 1,
        afterRetry: { awbNumber: null, supersededAt: null },
      });
      await svc.sweep(AT);
      expect(processOrder).toHaveBeenCalled();
    });

    it('resolves once the LIVE shipment carries a waybill', async () => {
      const { svc, raise, resolveByKey } = makeService({
        afterRetry: { awbNumber: 'DLV-1', supersededAt: null },
      });
      expect((await svc.sweep(AT)).awbless).toBe(0);
      expect(resolveByKey).toHaveBeenCalled();
      expect(raise).not.toHaveBeenCalled();
    });
  });

  describe('OrderAttentionService — the courier says one thing, the order says another', () => {
    const AT = new Date('2026-09-04T12:00:00Z');

    /** Only THIS watchdog's issues. The awbless check is unconditional
     *  too and raises its own in every sweep here, so "raise was never
     *  called" would be asserting something else entirely. */
    function trackingIssues(raise: jest.Mock): unknown[] {
      return raise.mock.calls.filter((c) =>
        String((c[0] as { dedupeKey?: string }).dedupeKey ?? '').startsWith('tracking-stranded:'),
      );
    }

    it('RAISES when a parcel’s scans have nowhere to go', async () => {
      // The shape the two real parcels had: the courier is somewhere
      // the order cannot reach, and the order has never been there.
      // (Their exact pair — DELIVERY_FAILED with a return-leg scan —
      // is a legal route now, which is the fix; this is the NEXT gap
      // of the same kind, whatever it turns out to be.)
      const { svc, raise } = makeService({
        stranded: [{ orderStatus: 'PACKED', shipmentStatus: 'DELIVERED' }],
      });
      const summary = await svc.sweep(AT);
      expect(summary.strandedTracking).toBe(1);
      expect(raise).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'HIGH',
          // Both sides named: "tracking is stuck" sends nobody anywhere.
          title: expect.stringContaining('DELIVERED'),
          metadata: expect.objectContaining({
            orderStatus: 'PACKED',
            shipmentStatus: 'DELIVERED',
            expectedOrderStatus: 'DELIVERED',
          }),
        }),
      );
    });

    it('stays QUIET for a stale scan — the order has already been there', async () => {
      // A scan arriving after the order moved past it is the ordinary
      // case the monotonic guard exists for. Flagging those would bury
      // the real one, and a watchdog that cries wolf gets muted.
      const { svc, raise } = makeService({
        stranded: [{ orderStatus: 'DELIVERED', shipmentStatus: 'IN_TRANSIT', timesAtTarget: 1 }],
      });
      const summary = await svc.sweep(AT);
      expect(summary.strandedTracking).toBe(0);
      expect(trackingIssues(raise)).toHaveLength(0);
    });

    it('stays quiet when the order is exactly where the courier says', async () => {
      const { svc, raise, resolveByKey } = makeService({
        stranded: [{ orderStatus: 'IN_TRANSIT', shipmentStatus: 'IN_TRANSIT' }],
      });
      expect((await svc.sweep(AT)).strandedTracking).toBe(0);
      expect(trackingIssues(raise)).toHaveLength(0);
      // ...and clears any issue it had raised before.
      expect(resolveByKey).toHaveBeenCalled();
    });

    it('stays quiet when the order CAN still get there — it just has not yet', async () => {
      // OUT_FOR_DELIVERY is in the allowed-from set for a DELIVERED scan,
      // so the next scan will move it. Nothing is stuck.
      const { svc, raise } = makeService({
        stranded: [{ orderStatus: 'OUT_FOR_DELIVERY', shipmentStatus: 'DELIVERED' }],
      });
      expect((await svc.sweep(AT)).strandedTracking).toBe(0);
      expect(trackingIssues(raise)).toHaveLength(0);
    });

    it('clears itself once the order catches up', async () => {
      const { svc, resolveByKey } = makeService({
        stranded: [{ orderStatus: 'RTO_IN_TRANSIT', shipmentStatus: 'RTO_IN_TRANSIT' }],
      });
      await svc.sweep(AT);
      expect(resolveByKey).toHaveBeenCalledWith(
        expect.stringContaining('tracking-stranded:'),
        expect.any(String),
      );
    });

    it('runs even with the NSA switch OFF — it is not an NSA flag', async () => {
      const { svc, raise } = makeService({
        stranded: [{ orderStatus: 'PACKED', shipmentStatus: 'DELIVERED' }],
      });
      await svc.sweep(AT);
      expect(raise).toHaveBeenCalled();
    });
  });
});
