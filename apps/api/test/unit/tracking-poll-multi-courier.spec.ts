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

function makeService(rows: Row[], sources: CourierTrackingSource[]) {
  const findMany = jest.fn(async (args: AnyArgs) =>
    rows
      .filter((r) => r.courierCode === args.where.courierCode)
      .map((r) => ({
        id: r.id,
        awbNumber: r.awbNumber,
        status: ShipmentStatus.HANDED_TO_COURIER,
        courierAccountId: r.courierAccountId,
        orderShipments: [{ orderId: `order-${r.id}` }],
      })),
  );
  const count = jest.fn(async () => 0);
  const upsert = jest.fn(async () => ({}));
  const client = {
    shipment: { findMany, count },
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
