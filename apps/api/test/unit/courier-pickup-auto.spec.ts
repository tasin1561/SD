import { CourierPickupService } from '../../src/modules/courier-ops/services/courier-pickup.service';

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
  const findFirstPickup = jest.fn(async () => opts.existingToday ?? null);
  const create = jest.fn(async (args: { data: AnyArgs }) => ({ ...created, ...args.data }));
  const update = jest.fn(async (args: { data: AnyArgs }) => ({ ...created, ...args.data }));
  const findManyShipment = jest.fn(async () => opts.waiting ?? [{ courierShipmentId: 'cs-1' }]);
  const audit = jest.fn(async (_input: AnyArgs) => undefined);
  const requestPickup = jest.fn(async () => ({
    raw: null,
    ...(opts.requestPickupResult ?? { success: true, pickupId: 'PU-AUTO-1', message: null }),
  }));

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
  );
  return { svc, create, update, audit, requestPickup, findFirstPickup, findManyShipment };
}

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
