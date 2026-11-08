import { AwbGenerationJobService } from '../../src/modules/courier-awb/services/awb-generation-job.service';
import { CourierPickupService } from '../../src/modules/courier-ops/services/courier-pickup.service';

/**
 * CUR-10 amendment #4 — a booked AWB asks for today's van, and pack time
 * stays as the backstop. Both entry points run through the SAME real
 * `CourierPickupService.raiseIfDue` over an in-memory pickup table, so the
 * per-(courier, warehouse, day) grain and the "FAILED day is never retried"
 * rule are exercised end to end rather than restated by a mock.
 */
type Row = {
  id: string;
  courierCode: string;
  warehouseId: string;
  pickupDate: Date;
  status: string;
  courierMessage: string | null;
};

const WH = 'wh-1';

function harness(
  opts: {
    delhiveryAuto?: boolean;
    manual?: boolean;
    courierCode?: string;
    pickupSucceeds?: boolean;
  } = {},
) {
  const rows: Row[] = [];
  const settings: Record<string, unknown> = {
    'courier.delhivery_auto_pickup_enabled': opts.delhiveryAuto ?? true,
    'courier.default_pickup_time': '',
    'courier.delhivery_pickup_location': 'Skydrop',
  };
  const requestPickup = jest.fn(async () => ({
    raw: null,
    success: opts.pickupSucceeds ?? true,
    pickupId: opts.pickupSucceeds === false ? null : 'PU-1',
    message: opts.pickupSucceeds === false ? 'courier said no' : null,
  }));
  const raiseIssue = jest.fn(async (_i: unknown) => ({ id: 'i', isNew: true }));
  const prisma = {
    client: {
      systemSetting: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
          const v = settings[where.key];
          return v === undefined ? null : { valueBoolean: v === true, valueString: String(v) };
        }),
      },
      courierPickupRequest: {
        findFirst: jest.fn(
          async ({ where }: { where: Row & { pickupDate: Date } }) =>
            rows.find(
              (r) =>
                r.courierCode === where.courierCode &&
                r.warehouseId === where.warehouseId &&
                r.pickupDate.getTime() === where.pickupDate.getTime(),
            ) ?? null,
        ),
        create: jest.fn(async ({ data }: { data: Omit<Row, 'id' | 'courierMessage'> }) => {
          const row = { ...data, id: `req-${rows.length + 1}`, courierMessage: null };
          rows.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          const row = rows.find((r) => r.id === where.id) as Row;
          Object.assign(row, data);
          return { ...row, pickupLocationName: 'Skydrop', pickupTime: '18:00:00' };
        }),
      },
      shipment: {
        findMany: jest.fn(async () => [{ courierShipmentId: 'cs' }]),
        findUnique: jest.fn(async () => ({
          originWarehouseId: WH,
          courierCode: opts.courierCode ?? 'delhivery',
          courierAccountId: null,
          isManualCourier: opts.manual ?? false,
        })),
      },
      courierAccount: { findUnique: jest.fn(async () => ({ pickupLocationName: null })) },
      warehouse: {
        findFirst: jest.fn(async () => ({ id: WH, name: 'Bengaluru DC', status: 'ACTIVE' })),
      },
    },
  };
  const pickups = new CourierPickupService(
    prisma as never,
    { log: jest.fn(async () => undefined) } as never,
    {
      requestPickup,
      pickupCourierCodes: () => ['delhivery', 'shiprocket'],
      pickupNeedsLocationName: (c: string) => c === 'delhivery',
      pickupSchedulesPerParcel: (c: string) => c === 'shiprocket',
    } as never,
    { raise: raiseIssue, resolveByKey: jest.fn(async () => 1) } as never,
  );
  const generation = {
    generateForShipment: jest.fn(async (shipmentId: string) => ({
      status: 'GENERATED' as const,
      shipmentId,
      awbNumber: `AWB-${shipmentId}`,
    })),
  };
  const job = new AwbGenerationJobService(
    prisma as never,
    { log: jest.fn() } as never,
    {} as never,
    generation as never,
    {} as never,
    { tryEarlyAccrual: jest.fn(async () => undefined) } as never,
    pickups,
  );
  // processOrder's first read: the live shipment link.
  (prisma.client as Record<string, unknown>).orderShipment = {
    findFirst: jest.fn(async () => ({ shipmentId: 'sh-1', shipment: { shipmentNumber: 'SH-1' } })),
  };
  const pack = (shipmentId: string) =>
    pickups.raiseIfDue({
      warehouseId: WH,
      courierCode: opts.courierCode ?? 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: shipmentId,
    });
  return { job, pack, rows, requestPickup, raiseIssue };
}

const DAY1 = new Date('2026-11-09T04:30:00Z'); // 10:00 IST
const DAY2 = new Date('2026-11-10T04:30:00Z');

describe('AWB booked → pickup requested (CUR-10 #4)', () => {
  beforeEach(() => jest.useFakeTimers({ now: DAY1, doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it('an AWB booked for an integrated courier raises the pickup for courier + warehouse + today', async () => {
    const h = harness();
    await h.job.processOrder('o1');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      courierCode: 'delhivery',
      warehouseId: WH,
      status: 'REQUESTED',
    });
    expect(h.requestPickup).toHaveBeenCalledTimes(1);
  });

  it('a second AWB the same day for the same courier/warehouse is a no-op', async () => {
    const h = harness();
    await h.job.processOrder('o1');
    await h.job.processOrder('o2');
    expect(h.rows).toHaveLength(1);
    expect(h.requestPickup).toHaveBeenCalledTimes(1);
  });

  it('a box packed the same day after the AWB already raised is a no-op', async () => {
    const h = harness();
    await h.job.processOrder('o1');
    const r = await h.pack('sh-1');
    expect(r.reason).toBe('ALREADY_REQUESTED_TODAY');
    expect(h.rows).toHaveLength(1);
    expect(h.requestPickup).toHaveBeenCalledTimes(1);
  });

  it('a box packed the NEXT day raises a fresh pickup for that day (the backstop)', async () => {
    const h = harness();
    await h.job.processOrder('o1');
    jest.setSystemTime(DAY2);
    const r = await h.pack('sh-1');
    expect(r.reason).toBe('REQUESTED');
    expect(h.rows).toHaveLength(2);
    expect(h.rows[1]!.pickupDate.getTime()).toBeGreaterThan(h.rows[0]!.pickupDate.getTime());
    expect(h.requestPickup).toHaveBeenCalledTimes(2);
  });

  it('a MANUAL courier raises nothing', async () => {
    const h = harness({ manual: true, courierCode: 'manual' });
    await h.job.processOrder('o1');
    expect(h.rows).toHaveLength(0);
    expect(h.requestPickup).not.toHaveBeenCalled();
  });

  it('the auto-pickup switch off raises nothing', async () => {
    const h = harness({ delhiveryAuto: false });
    await h.job.processOrder('o1');
    expect(h.rows).toHaveLength(0);
    expect(h.requestPickup).not.toHaveBeenCalled();
    expect(h.raiseIssue).not.toHaveBeenCalled();
  });

  it('a failed day is not retried by a later AWB or a later pack, and a HIGH issue is raised', async () => {
    const h = harness({ pickupSucceeds: false });
    await h.job.processOrder('o1');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.status).toBe('FAILED');
    await h.job.processOrder('o2');
    const r = await h.pack('sh-1');
    expect(r.reason).toBe('DAY_FAILED');
    expect(h.requestPickup).toHaveBeenCalledTimes(1);
    expect(h.rows).toHaveLength(1);
    expect(h.raiseIssue).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'HIGH', kind: 'INTEGRATION' }),
    );
  });
});
