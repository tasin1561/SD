import { Prisma } from '@skydrop/db';
import {
  CourierPickupService,
  pickupDateFor,
} from '../../src/modules/courier-ops/services/courier-pickup.service';

/**
 * `raiseIfDue` — the CUR-10 per-category auto-pickup switch.
 *
 * A packed parcel asks whether today's van has been requested yet. This
 * pins the three things that keep it inside CUR-10's discipline: OFF by
 * default, per-day idempotent so ten boxes closing produce one call not
 * ten, and the request row it writes records a RUNNER, never a person
 * who did not make the decision.
 */
type AnyArgs = Record<string, unknown>;

const WAREHOUSE_ID = '0198f3c2-0000-7000-8000-00000000ware';

function make(
  opts: {
    autoPickupEnabled?: boolean;
    pickupTime?: string;
    pickupLocation?: string;
    existingToday?: AnyArgs | null;
    waiting?: Array<{ courierShipmentId: string | null }>;
    requestPickupResult?: { success: boolean; pickupId: string | null; message: string | null };
    requestPickupThrows?: Error;
    createThrows?: unknown;
    pickupLookupThrows?: Error;
    accountPickupLocation?: string | null;
  } = {},
) {
  const created = {
    id: 'req-auto-1',
    courierCode: 'delhivery',
    warehouseId: WAREHOUSE_ID,
    pickupLocationName: 'Skydrop',
    pickupDate: new Date(),
    pickupTime: '18:00:00',
    expectedPackageCount: 1,
    status: 'REQUESTED',
    courierPickupId: null as string | null,
    courierMessage: null as string | null,
    createdAt: new Date(),
  };

  const settingsByKey: Record<string, AnyArgs> = {
    'courier.delhivery_auto_pickup_enabled': { valueBoolean: opts.autoPickupEnabled ?? false },
    'courier.shiprocket_auto_pickup_enabled': { valueBoolean: opts.autoPickupEnabled ?? false },
    'courier.default_pickup_time': { valueString: opts.pickupTime ?? '' },
    'courier.delhivery_pickup_location': { valueString: opts.pickupLocation ?? 'Skydrop' },
  };

  const findUniqueSetting = jest.fn(async ({ where }: { where: { key: string } }) => {
    return settingsByKey[where.key] ?? null;
  });
  const findFirstPickup = jest.fn(async () => {
    if (opts.pickupLookupThrows !== undefined) throw opts.pickupLookupThrows;
    return opts.existingToday ?? null;
  });
  const create = jest.fn(async (args: { data: AnyArgs }) => {
    if (opts.createThrows !== undefined) throw opts.createThrows;
    return { ...created, ...args.data };
  });
  const update = jest.fn(async (args: { data: AnyArgs }) => ({ ...created, ...args.data }));
  const findManyShipment = jest.fn(async () => opts.waiting ?? [{ courierShipmentId: 'cs-1' }]);
  const audit = jest.fn(async (_input: AnyArgs) => undefined);
  const requestPickup = jest.fn(async (_input: AnyArgs) => {
    if (opts.requestPickupThrows !== undefined) throw opts.requestPickupThrows;
    return {
      raw: null,
      ...(opts.requestPickupResult ?? { success: true, pickupId: 'PU-AUTO-1', message: null }),
    };
  });
  const raiseIssue = jest.fn(async (_input: AnyArgs) => ({ id: 'issue-1', isNew: true }));
  const resolveByKey = jest.fn(async (_key: string, _note: string) => 1);

  const prisma = {
    client: {
      systemSetting: { findUnique: findUniqueSetting },
      courierPickupRequest: {
        findFirst: findFirstPickup,
        create,
        update,
        findMany: jest.fn(async () => []),
      },
      shipment: { findMany: findManyShipment },
      courierAccount: {
        findUnique: jest.fn(async () => ({
          pickupLocationName: opts.accountPickupLocation ?? null,
        })),
      },
      warehouse: {
        findFirst: jest.fn(async () => ({
          id: WAREHOUSE_ID,
          name: 'Bengaluru DC',
          status: 'ACTIVE',
        })),
      },
    },
  };

  const svc = new CourierPickupService(
    prisma as never,
    { log: audit } as never,
    { requestPickup } as never,
    { raise: raiseIssue, resolveByKey } as never,
  );
  return {
    svc,
    create,
    update,
    audit,
    requestPickup,
    findFirstPickup,
    findManyShipment,
    raiseIssue,
    resolveByKey,
  };
}

const BOX = {
  warehouseId: WAREHOUSE_ID,
  courierCode: 'delhivery',
  courierAccountId: null,
  triggeredByShipmentId: '0198f3c2-0000-7000-8000-0000000000sh',
};
const ISSUE_KEY = `auto-pickup:delhivery:${WAREHOUSE_ID}`;

describe('CourierPickupService.raiseIfDue', () => {
  it('does nothing while the switch is off — the default', async () => {
    const { svc, create, requestPickup } = make({ autoPickupEnabled: false });
    const r = await svc.raiseIfDue({
      warehouseId: WAREHOUSE_ID,
      courierCode: 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: 's1',
    });
    expect(r).toEqual({ fired: false, reason: 'AUTO_PICKUP_DISABLED', requestId: null });
    expect(create).not.toHaveBeenCalled();
    expect(requestPickup).not.toHaveBeenCalled();
  });

  it('refuses a courier with no adapter, even before checking the switch', async () => {
    const { svc, create } = make({ autoPickupEnabled: true });
    const r = await svc.raiseIfDue({
      warehouseId: WAREHOUSE_ID,
      courierCode: 'manual',
      courierAccountId: null,
      triggeredByShipmentId: 's1',
    });
    expect(r.reason).toBe('NO_ADAPTER');
    expect(create).not.toHaveBeenCalled();
  });

  it('fires once when enabled and no request exists for today', async () => {
    const { svc, create, requestPickup } = make({
      autoPickupEnabled: true,
      waiting: [{ courierShipmentId: 'a' }, { courierShipmentId: 'b' }],
    });
    const r = await svc.raiseIfDue({
      warehouseId: WAREHOUSE_ID,
      courierCode: 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: 's1',
    });
    expect(r.fired).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(requestPickup).toHaveBeenCalledTimes(1);
    // The headcount comes from the same query the manual Shiprocket path
    // uses — two parcels waiting, so the van is told to expect two.
    const data = create.mock.calls[0]?.[0]?.data as AnyArgs;
    expect(data['expectedPackageCount']).toBe(2);
  });

  it('is a no-op — and calls the courier ZERO times — once today is already claimed', async () => {
    // Ten boxes closing on the same day at the same warehouse must
    // produce ONE van, not ten.
    const { svc, create, requestPickup } = make({
      autoPickupEnabled: true,
      existingToday: { id: 'already-there' },
    });
    const r = await svc.raiseIfDue({
      warehouseId: WAREHOUSE_ID,
      courierCode: 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: 's2',
    });
    expect(r).toEqual({
      fired: false,
      reason: 'ALREADY_REQUESTED_TODAY',
      requestId: 'already-there',
    });
    expect(create).not.toHaveBeenCalled();
    expect(requestPickup).not.toHaveBeenCalled();
  });

  it('a van already booked today clears an open "no van" issue for the building', async () => {
    const { svc, resolveByKey } = make({
      autoPickupEnabled: true,
      existingToday: { id: 'already-there', status: 'REQUESTED' },
    });
    await svc.raiseIfDue(BOX);
    expect(resolveByKey).toHaveBeenCalledWith(ISSUE_KEY, expect.any(String));
  });

  it('a MANUAL raise that succeeds clears the issue too — a van is a van', async () => {
    const { svc, resolveByKey } = make({});
    await svc.raise(
      'staff-1',
      {
        warehouseId: WAREHOUSE_ID,
        courierCode: 'delhivery',
        courierAccountId: null,
        pickupDate: '2026-09-13',
        pickupTime: '18:00:00',
        expectedPackageCount: 3,
      },
      { ipAddress: null, userAgent: null, requestId: null },
    );
    expect(resolveByKey).toHaveBeenCalledWith(ISSUE_KEY, expect.any(String));
  });

  it('the headcount floors at 1 even if the waiting query comes back empty', async () => {
    const { svc, create } = make({ autoPickupEnabled: true, waiting: [] });
    await svc.raiseIfDue({
      warehouseId: WAREHOUSE_ID,
      courierCode: 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: 's1',
    });
    const data = create.mock.calls[0]?.[0]?.data as AnyArgs;
    expect(data['expectedPackageCount']).toBe(1);
  });

  it('records a RUNNER, never a person who did not make the decision', async () => {
    const { svc, create, audit } = make({ autoPickupEnabled: true });
    await svc.raiseIfDue({
      warehouseId: WAREHOUSE_ID,
      courierCode: 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: 's1',
    });
    const data = create.mock.calls[0]?.[0]?.data as AnyArgs;
    expect(data['requestedByStaffId']).toBeNull();

    const auditCall = audit.mock.calls.find(
      (c) => (c[0] as AnyArgs)['action'] === 'courier.pickup.auto_requested',
    );
    expect(auditCall).toBeDefined();
    expect((auditCall?.[0] as AnyArgs)['actorType']).toBe('SYSTEM');
    expect((auditCall?.[0] as AnyArgs)['staffUserId']).toBeNull();
  });

  it('falls back to 18:00:00 when no default pickup time is configured', async () => {
    const { svc, create } = make({ autoPickupEnabled: true, pickupTime: '' });
    await svc.raiseIfDue({
      warehouseId: WAREHOUSE_ID,
      courierCode: 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: 's1',
    });
    const data = create.mock.calls[0]?.[0]?.data as AnyArgs;
    expect(data['pickupTime']).toBe('18:00:00');
  });
});

/**
 * 2026-09-12: production had auto-pickup ON for both couriers and an
 * EMPTY `courier_pickup_requests` table. Every box packed since the
 * switch went on was a manual-courier parcel (skipped by design), so the
 * trigger never ran — but had it run and failed, nobody would have
 * known: the outcome was returned to a caller that ignored it, and a
 * pre-claim refusal escaped as one warn line. These pin that every
 * outcome leaving a box with no van is SAID, and that saying it never
 * turns into a second call to the courier.
 */
describe('CourierPickupService.raiseIfDue — nothing fails quietly', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a FAILED day is never retried automatically, and the courier is called ZERO times', async () => {
    const { svc, create, requestPickup, raiseIssue } = make({
      autoPickupEnabled: true,
      existingToday: { id: 'failed-1', status: 'FAILED', courierMessage: 'no slots' },
    });
    for (let i = 0; i < 3; i += 1) {
      const r = await svc.raiseIfDue(BOX);
      expect(r).toEqual({ fired: false, reason: 'DAY_FAILED', requestId: 'failed-1' });
    }
    expect(create).not.toHaveBeenCalled();
    expect(requestPickup).not.toHaveBeenCalled();
    // …but each box re-states the ONE issue rather than staying silent.
    expect(raiseIssue).toHaveBeenCalled();
    expect(raiseIssue.mock.calls.every((c) => c[0]['dedupeKey'] === ISSUE_KEY)).toBe(true);
  });

  it('a courier refusal keeps the day FAILED and raises a HIGH issue — and clears nothing', async () => {
    const { svc, update, raiseIssue, resolveByKey } = make({
      autoPickupEnabled: true,
      requestPickupResult: { success: false, pickupId: null, message: 'location not found' },
    });
    const r = await svc.raiseIfDue(BOX);
    expect(r.fired).toBe(false);
    expect(r.reason).toBe('COURIER_FAILED');
    expect(update.mock.calls.at(-1)?.[0]?.data).toMatchObject({ status: 'FAILED' });
    const issue = raiseIssue.mock.calls[0]?.[0] as AnyArgs;
    expect(issue).toMatchObject({ kind: 'INTEGRATION', severity: 'HIGH', dedupeKey: ISSUE_KEY });
    expect(String(issue['detail'])).toContain('location not found');
    expect(resolveByKey).not.toHaveBeenCalled();
  });

  it('a courier call that throws is reported the same way, and does not throw to the packer', async () => {
    const { svc, raiseIssue } = make({
      autoPickupEnabled: true,
      requestPickupThrows: new Error('socket hang up'),
    });
    const r = await svc.raiseIfDue(BOX);
    expect(r).toMatchObject({ fired: false, reason: 'COURIER_FAILED' });
    expect(raiseIssue).toHaveBeenCalledTimes(1);
  });

  it('no pickup location configured: no row, no courier call, an audit row AND an issue saying what to set', async () => {
    const { svc, create, requestPickup, audit, raiseIssue } = make({
      autoPickupEnabled: true,
      pickupLocation: '',
    });
    const r = await svc.raiseIfDue(BOX);
    expect(r).toEqual({
      fired: false,
      reason: 'NOT_RAISED',
      requestId: null,
      detail: 'PICKUP_LOCATION_NOT_CONFIGURED',
    });
    expect(create).not.toHaveBeenCalled();
    expect(requestPickup).not.toHaveBeenCalled();
    const auditRow = audit.mock.calls.find(
      (c) => c[0]['action'] === 'courier.pickup.auto_not_raised',
    )?.[0];
    expect(auditRow).toMatchObject({ actorType: 'SYSTEM', entityId: BOX.triggeredByShipmentId });
    const issue = raiseIssue.mock.calls[0]?.[0] as AnyArgs;
    expect(issue['dedupeKey']).toBe(ISSUE_KEY);
    expect(String(issue['detail'])).toContain('/courier-accounts');
    expect(String(issue['detail'])).toContain('courier.delhivery_pickup_location');
  });

  it('never throws, even when the lookup itself fails', async () => {
    const { svc, requestPickup, raiseIssue } = make({
      autoPickupEnabled: true,
      pickupLookupThrows: new Error('connection reset'),
    });
    const r = await svc.raiseIfDue(BOX);
    expect(r).toMatchObject({ fired: false, reason: 'NOT_RAISED' });
    expect(requestPickup).not.toHaveBeenCalled();
    expect(raiseIssue).toHaveBeenCalledTimes(1);
  });

  it('two boxes racing for the day: the loser is a quiet no-op, not an issue', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { svc, requestPickup, raiseIssue } = make({
      autoPickupEnabled: true,
      createThrows: p2002,
    });
    const r = await svc.raiseIfDue(BOX);
    expect(r.reason).toBe('ALREADY_REQUESTED_TODAY');
    expect(requestPickup).not.toHaveBeenCalled();
    expect(raiseIssue).not.toHaveBeenCalled();
  });

  it('the racing loser clears the issue — the winner booked the van', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { svc, resolveByKey } = make({ autoPickupEnabled: true, createThrows: p2002 });
    await svc.raiseIfDue(BOX);
    expect(resolveByKey).toHaveBeenCalledWith(ISSUE_KEY, expect.any(String));
  });

  it('a successful request clears the (courier, warehouse) issue', async () => {
    const { svc, resolveByKey, raiseIssue } = make({ autoPickupEnabled: true });
    const r = await svc.raiseIfDue(BOX);
    expect(r.fired).toBe(true);
    expect(resolveByKey).toHaveBeenCalledWith(ISSUE_KEY, expect.any(String));
    expect(raiseIssue).not.toHaveBeenCalled();
  });

  it("uses the account's own pickup location over the global one — as the AWB booking does", async () => {
    const { svc, create, requestPickup } = make({
      autoPickupEnabled: true,
      pickupLocation: 'MSEXPORT',
      accountPickupLocation: 'MS-ACCOUNT',
    });
    await svc.raiseIfDue({ ...BOX, courierAccountId: 'acc-1' } as never);
    expect((create.mock.calls[0]?.[0]?.data as AnyArgs)['pickupLocationName']).toBe('MS-ACCOUNT');
    expect(requestPickup.mock.calls[0]?.[0]).toMatchObject({ pickupLocation: 'MS-ACCOUNT' });
  });

  it("a box closed after today's van time asks for TOMORROW's van", async () => {
    // 19:30 IST, van at 18:00 — a request for today would be for the past.
    jest.useFakeTimers({ now: new Date('2026-09-12T14:00:00.000Z') });
    const { svc, create, findFirstPickup } = make({
      autoPickupEnabled: true,
      pickupTime: '18:00:00',
    });
    await svc.raiseIfDue(BOX);
    const data = create.mock.calls[0]?.[0]?.data as AnyArgs;
    expect((data['pickupDate'] as Date).toISOString().slice(0, 10)).toBe('2026-09-13');
    // …and the one-per-day check looked at tomorrow, not today.
    const lookup = (findFirstPickup.mock.calls as unknown as Array<[{ where: AnyArgs }]>)[0];
    expect((lookup?.[0].where['pickupDate'] as Date).toISOString().slice(0, 10)).toBe('2026-09-13');
  });
});

describe('pickupDateFor', () => {
  it('is today while the van time is still ahead (IST)', () => {
    // 11:00 IST
    expect(pickupDateFor('18:00:00', new Date('2026-09-12T05:30:00.000Z'))).toBe('2026-09-12');
  });
  it('is tomorrow at or after the van time', () => {
    expect(pickupDateFor('18:00:00', new Date('2026-09-12T12:30:00.000Z'))).toBe('2026-09-13');
    expect(pickupDateFor('18:00', new Date('2026-09-12T12:31:00.000Z'))).toBe('2026-09-13');
  });
  it('reads an unpadded hour numerically — "9:30" is morning, not after 17:00', () => {
    // 08:00 IST: still before a 9:30 van, so today.
    expect(pickupDateFor('9:30', new Date('2026-09-12T02:30:00.000Z'))).toBe('2026-09-12');
    // 10:00 IST: past it, so tomorrow.
    expect(pickupDateFor('9:30', new Date('2026-09-12T04:30:00.000Z'))).toBe('2026-09-13');
  });

  it('rolls the month', () => {
    expect(pickupDateFor('18:00:00', new Date('2026-09-30T15:00:00.000Z'))).toBe('2026-10-01');
  });
  it('reads the IST calendar day, not UTC — 01:00 IST is already the next day', () => {
    // 2026-09-12T19:30Z = 01:00 IST on the 13th, before that day's van.
    expect(pickupDateFor('18:00:00', new Date('2026-09-12T19:30:00.000Z'))).toBe('2026-09-13');
  });
});
