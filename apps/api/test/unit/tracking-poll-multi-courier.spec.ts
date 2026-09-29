import { ShipmentStatus } from '@skydrop/db';
import { TrackingPollService } from '../../src/modules/tracking-poll/services/tracking-poll.service';
import type { CourierTrackingSource } from '../../src/modules/courier-shared/services/courier-tracking-source';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { TrackingStatusMappingService } from '../../src/modules/tracking-events/services/tracking-status-mapping.service';
import type { TrackingEventAppendService } from '../../src/modules/tracking-events/services/tracking-event-append.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = any;

interface Row {
  id: string;
  awbNumber: string;
  courierCode: string;
  courierAccountId: string | null;
}

function makeSource(over: Partial<CourierTrackingSource> & { courierCode: string }) {
  const fetchTracking = jest.fn<Promise<AnyArgs[]>, [readonly string[], string | null]>(
    async () => [],
  );
  const src = {
    maxAwbsPerCall: 50,
    perAccount: false,
    stubRemedy: 'set the base url',
    isStubMode: async () => false,
    fetchTracking,
    normalizeScan: () => ({ kind: 'UNMAPPABLE' as const, reason: 'x' }),
    ...over,
  } as unknown as CourierTrackingSource;
  return { src, fetchTracking };
}

function makeService(
  rows: Row[],
  sources: CourierTrackingSource[],
  /** Which couriers have an active account — the token a lookup needs. */
  accountsByCourier: Record<string, string | null> = {},
) {
  const findMany = jest.fn(async (args: AnyArgs) => {
    // `lookup` asks for a LIST of waybills; `pollAll` asks by courier
    // code with `awbNumber: { not: null }`. One fake, two shapes,
    // because both go through the same table — discriminate on `in`,
    // not on the key being present, or the poll takes the wrong branch.
    if (args.where.awbNumber?.in !== undefined) {
      const wanted: string[] = args.where.awbNumber.in;
      return rows
        .filter((r) => wanted.includes(r.awbNumber))
        .map((r) => ({
          id: r.id,
          awbNumber: r.awbNumber,
          courierCode: r.courierCode,
          courierAccountId: r.courierAccountId,
        }));
    }
    return rows
      .filter((r) => r.courierCode === args.where.courierCode)
      .map((r) => ({
        id: r.id,
        awbNumber: r.awbNumber,
        status: ShipmentStatus.HANDED_TO_COURIER,
        courierAccountId: r.courierAccountId,
        orderShipments: [{ orderId: `order-${r.id}` }],
      }));
  });
  const count = jest.fn(async () => 0);
  const upsert = jest.fn(async () => ({}));
  const accountFindFirst = jest.fn(async (args: AnyArgs) => {
    const id = accountsByCourier[args.where.courier.code];
    return id === undefined || id === null ? null : { id };
  });
  const client = {
    shipment: { findMany, count },
    courierAccount: { findFirst: accountFindFirst },
    systemSetting: { upsert, findUnique: jest.fn(async () => null) },
  };
  const svc = new TrackingPollService(
    { client } as unknown as PrismaService,
    sources,
    {} as unknown as TrackingStatusMappingService,
    { latestForShipment: jest.fn(async () => null) } as unknown as TrackingEventAppendService,
    {} as unknown as OrderWriteService,
    { log: jest.fn(async () => undefined) } as unknown as AuditLogService,
  );
  return { svc, findMany };
}

/**
 * The poll cycle became courier-agnostic so a Shiprocket parcel would
 * update at all. These tests pin the three properties that make that
 * true, each of which would fail SILENTLY — a parcel that simply never
 * moves, with nothing in the logs saying why.
 */
describe('TrackingPollService — multiple couriers', () => {
  it('polls each courier for ITS OWN parcels, never the other courier’s', async () => {
    const dl = makeSource({ courierCode: 'delhivery' });
    const sr = makeSource({ courierCode: 'shiprocket', perAccount: true });
    const { svc } = makeService(
      [
        { id: 's1', awbNumber: 'DLV1', courierCode: 'delhivery', courierAccountId: 'dl-1' },
        { id: 's2', awbNumber: 'SR1', courierCode: 'shiprocket', courierAccountId: 'sr-1' },
      ],
      [dl.src, sr.src],
    );

    await svc.pollAll();

    // Asking Delhivery about a Shiprocket waybill returns "not found",
    // which is indistinguishable from a parcel that has not moved.
    expect(dl.fetchTracking).toHaveBeenCalledWith(['DLV1'], null);
    expect(sr.fetchTracking).toHaveBeenCalledWith(['SR1'], 'sr-1');
  });

  it('groups a per-account courier BY ACCOUNT, one call each', async () => {
    const sr = makeSource({ courierCode: 'shiprocket', perAccount: true });
    const { svc } = makeService(
      [
        { id: 's1', awbNumber: 'SR1', courierCode: 'shiprocket', courierAccountId: 'acc-A' },
        { id: 's2', awbNumber: 'SR2', courierCode: 'shiprocket', courierAccountId: 'acc-B' },
      ],
      [sr.src],
    );

    await svc.pollAll();

    // Their bearer token belongs to one account. One call carrying both
    // AWBs would poll acc-B's parcel with acc-A's token and be told it
    // does not exist.
    expect(sr.fetchTracking).toHaveBeenCalledTimes(2);
    const calls = sr.fetchTracking.mock.calls.map((c) => [c[0], c[1]]);
    expect(calls).toContainEqual([['SR1'], 'acc-A']);
    expect(calls).toContainEqual([['SR2'], 'acc-B']);
  });

  it('one courier being down does not stop the other courier’s parcels updating', async () => {
    const dl = makeSource({ courierCode: 'delhivery' });
    const sr = makeSource({ courierCode: 'shiprocket' });
    sr.fetchTracking.mockRejectedValue(new Error('shiprocket 503'));
    const { svc } = makeService(
      [
        { id: 's1', awbNumber: 'DLV1', courierCode: 'delhivery', courierAccountId: null },
        { id: 's2', awbNumber: 'SR1', courierCode: 'shiprocket', courierAccountId: null },
      ],
      [dl.src, sr.src],
    );

    const summary = await svc.pollAll();

    // Both were attempted, and the cycle completed rather than throwing.
    expect(dl.fetchTracking).toHaveBeenCalled();
    expect(sr.fetchTracking).toHaveBeenCalled();
    expect(summary.shipmentsExamined).toBe(2);
  });

  /**
   * `lookup` is the "is realtime tracking working" tool, and it passed a
   * NULL account to every source. Shiprocket's `fetchTracking` refuses
   * that outright, and lookup's catch — written for "that waybill is not
   * mine" — swallowed the refusal, so every Shiprocket waybill came back
   * `known: false` with no scans, from a call that never happened.
   * Measured on production 2026-09-29 against three waybills their own
   * webhooks were reporting on that hour.
   */
  describe('lookup asks a per-account courier WITH an account', () => {
    it('uses the account that booked the parcel when the parcel is ours', async () => {
      const dl = makeSource({ courierCode: 'delhivery' });
      const sr = makeSource({ courierCode: 'shiprocket', perAccount: true });
      const { svc } = makeService(
        [{ id: 's2', awbNumber: 'SR1', courierCode: 'shiprocket', courierAccountId: 'sr-1' }],
        [dl.src, sr.src],
        { shiprocket: 'sr-default', delhivery: null },
      );

      const out = await svc.lookup(['SR1']);

      expect(sr.fetchTracking).toHaveBeenCalledWith(['SR1'], 'sr-1');
      // Delhivery has one estate credential, so null is right for it.
      expect(dl.fetchTracking).toHaveBeenCalledWith(['SR1'], null);
      expect(out.unaskedCouriers).toEqual([]);
    });

    it('falls back to the courier’s first active account for a waybill that is not ours', async () => {
      const sr = makeSource({ courierCode: 'shiprocket', perAccount: true });
      const { svc } = makeService([], [sr.src], { shiprocket: 'sr-default' });

      await svc.lookup(['SOMEBODY-ELSES']);

      expect(sr.fetchTracking).toHaveBeenCalledWith(['SOMEBODY-ELSES'], 'sr-default');
    });

    it('NAMES a courier it could not ask, rather than reporting silence as “unknown waybill”', async () => {
      const sr = makeSource({ courierCode: 'shiprocket', perAccount: true });
      const { svc } = makeService([], [sr.src], { shiprocket: null });

      const out = await svc.lookup(['SR1']);

      expect(sr.fetchTracking).not.toHaveBeenCalled();
      expect(out.unaskedCouriers).toEqual(['shiprocket']);
      // The waybill still reads as unknown — but the caller now has the
      // one fact that makes that reading honest.
      expect(out.results[0]?.known).toBe(false);
    });

    it('splits one call per account when the waybills were booked on different ones', async () => {
      const sr = makeSource({ courierCode: 'shiprocket', perAccount: true });
      const { svc } = makeService(
        [
          { id: 'a', awbNumber: 'SR1', courierCode: 'shiprocket', courierAccountId: 'acc-A' },
          { id: 'b', awbNumber: 'SR2', courierCode: 'shiprocket', courierAccountId: 'acc-B' },
        ],
        [sr.src],
        { shiprocket: 'acc-A' },
      );

      await svc.lookup(['SR1', 'SR2']);

      const calls = sr.fetchTracking.mock.calls.map((c) => [c[0], c[1]]);
      expect(calls).toContainEqual([['SR1'], 'acc-A']);
      expect(calls).toContainEqual([['SR2'], 'acc-B']);
    });
  });

  it('reports stub mode only when EVERY courier is stubbed', async () => {
    const stubbed = makeSource({ courierCode: 'shiprocket', isStubMode: async () => true });
    const live = makeSource({ courierCode: 'delhivery' });

    const mixed = makeService([], [live.src, stubbed.src]);
    // One configured courier means tracking genuinely runs; calling the
    // whole cycle "stub mode" would tell an operator nothing is polling
    // when half the estate is.
    expect((await mixed.svc.pollAll()).stubMode).toBe(false);

    const allStub = makeService([], [stubbed.src]);
    expect((await allStub.svc.pollAll()).stubMode).toBe(true);
  });
});
