import { ShipmentStatus } from '@skydrop/db';
import { TrackingEventAppendService } from '../../src/modules/tracking-events/services/tracking-event-append.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * "How long has this been waiting" is a question about the COURIER'S
 * scan, not about our row.
 *
 * ── THE TRAP ─────────────────────────────────────────────────────────
 * `shipments.updatedAt` is `@updatedAt`, so ANY write to the row resets
 * it — a courier cost landing from the nightly sync, an account
 * backfill, a supersede touching a sibling field. The returns worklist
 * shipped using it and reported **0h** for a parcel that had been at our
 * door since 4 September. Worse than no number, because it looks
 * precise; and the watchdog read the same field, so its alert could
 * never have fired either.
 *
 * `tracking_events.eventAt` is the courier's own scan time (TRK-3) and
 * is the fact actually being asked about.
 */
function makeSut(rows: Array<{ shipmentId: string; eventAt: Date | null }>) {
  const groupBy = jest.fn(async () =>
    rows.map((r) => ({ shipmentId: r.shipmentId, _max: { eventAt: r.eventAt } })),
  );
  const prisma = { client: { trackingEvent: { groupBy } } } as unknown as PrismaService;
  return { svc: new TrackingEventAppendService(prisma), groupBy };
}

describe('reachedStatusAt', () => {
  it('returns the courier scan time per parcel', async () => {
    const at = new Date('2026-09-04T12:58:00Z');
    const { svc } = makeSut([{ shipmentId: 's1', eventAt: at }]);

    const map = await svc.reachedStatusAt(['s1'], [ShipmentStatus.RTO_DELIVERED]);

    expect(map.get('s1')).toEqual(at);
  });

  it('asks ONCE for the whole set, not once per parcel', async () => {
    // A per-row lookup against the tracking HYPERTABLE is how a page
    // that opens instantly with three returns times out with three
    // hundred.
    const { svc, groupBy } = makeSut([
      { shipmentId: 's1', eventAt: new Date() },
      { shipmentId: 's2', eventAt: new Date() },
      { shipmentId: 's3', eventAt: new Date() },
    ]);

    await svc.reachedStatusAt(['s1', 's2', 's3'], [ShipmentStatus.RTO_DELIVERED]);

    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  it('OMITS a parcel with no matching scan rather than inventing a time', async () => {
    // The caller knows what its own fallback should be. Substituting
    // `now` here would be the same quiet wrongness this replaces —
    // a parcel that has waited for days reading as fresh.
    const { svc } = makeSut([{ shipmentId: 's1', eventAt: null }]);

    const map = await svc.reachedStatusAt(['s1'], [ShipmentStatus.RTO_DELIVERED]);

    expect(map.has('s1')).toBe(false);
  });

  it('does not query at all for an empty set', async () => {
    const { svc, groupBy } = makeSut([]);

    await expect(svc.reachedStatusAt([], [ShipmentStatus.RTO_DELIVERED])).resolves.toEqual(
      new Map(),
    );
    await expect(svc.reachedStatusAt(['s1'], [])).resolves.toEqual(new Map());
    expect(groupBy).not.toHaveBeenCalled();
  });
});
