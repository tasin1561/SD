import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PickupRequestStatus, Prisma, WarehouseStatus } from '@skydrop/db';
import { CourierPickupService } from '../../src/modules/courier-ops/services/courier-pickup.service';

const WAREHOUSE_ID = '0198f3c2-0000-7000-8000-00000000ware';
const REQUEST_ID = '0198f3c2-0000-7000-8000-0000000000rq';
const CLIENT = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function make(
  opts: {
    warehouse?: { status?: WarehouseStatus } | null;
    pickupLocation?: string;
    createThrows?: unknown;
    requestPickupResult?: {
      success: boolean;
      pickupId: string | null;
      message: string | null;
    };
    requestPickupThrows?: Error;
    existing?: Record<string, unknown> | null;
  } = {},
) {
  const created = {
    id: REQUEST_ID,
    courierCode: 'delhivery',
    warehouseId: WAREHOUSE_ID,
    pickupLocationName: 'Skydrop',
    pickupDate: new Date('2026-07-28T00:00:00.000Z'),
    pickupTime: '16:00:00',
    expectedPackageCount: 20,
    status: PickupRequestStatus.REQUESTED,
    courierPickupId: null as string | null,
    courierMessage: null as string | null,
    createdAt: new Date(),
  };

  const create = jest.fn(async () => {
    if (opts.createThrows !== undefined) throw opts.createThrows;
    return created;
  });
  const update = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    ...created,
    ...args.data,
  }));
  const del = jest.fn(async () => created);
  const findUnique = jest.fn(async () => opts.existing ?? null);
  const audit = jest.fn(async () => undefined);
  const requestPickup = jest.fn(async () => {
    if (opts.requestPickupThrows !== undefined) throw opts.requestPickupThrows;
    return {
      raw: null,
      ...(opts.requestPickupResult ?? {
        success: true,
        pickupId: 'PU-1',
        message: 'ok',
      }),
    };
  });

  const prisma = {
    client: {
      warehouse: {
        findFirst: jest.fn(async () =>
          opts.warehouse === null
            ? null
            : {
                id: WAREHOUSE_ID,
                name: 'Bengaluru DC',
                status: opts.warehouse?.status ?? WarehouseStatus.ACTIVE,
              },
        ),
      },
      systemSetting: {
        findUnique: jest.fn(async () => ({
          valueString: opts.pickupLocation ?? 'Skydrop',
        })),
      },
      courierPickupRequest: {
        create,
        update,
        delete: del,
        findUnique,
        findMany: jest.fn(async () => []),
      },
    },
  };

  const svc = new CourierPickupService(
    prisma as never,
    { log: audit } as never,
    { requestPickup } as never,
  );
  return { svc, create, update, del, audit, requestPickup };
}

const VALID = {
  warehouseId: WAREHOUSE_ID,
  pickupDate: '2026-07-28',
  pickupTime: '16:00:00',
  expectedPackageCount: 20,
};

/**
 * A pickup summons a physical vehicle, and Delhivery permits only one
 * open request per location per day. Everything here is about not
 * booking two.
 */
describe('CourierPickupService.raise', () => {
  it('claims the day BEFORE calling the courier, so a crash cannot lose the record', async () => {
    const { svc, create, requestPickup } = make();
    await svc.raise('staff-1', VALID, CLIENT);
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan(
      requestPickup.mock.invocationCallOrder[0]!,
    );
  });

  it('turns the unique violation into a readable 409, not a Prisma error', async () => {
    // The UNIQUE is the courier's one-per-day rule. Hitting it means
    // somebody already asked — which the operator needs told in words.
    const { svc, requestPickup } = make({ createThrows: p2002() });
    await expect(svc.raise('staff-1', VALID, CLIENT)).rejects.toBeInstanceOf(ConflictException);
    expect(requestPickup).not.toHaveBeenCalled();
  });

  it('KEEPS the day claimed when the courier call fails', async () => {
    // We cannot tell "they never got it" from "they got it and the
    // response was lost". Freeing the slot on failure is how two vans
    // arrive, so the row stays and is marked FAILED.
    const { svc, update } = make({
      requestPickupThrows: new Error('socket hang up'),
    });
    await expect(svc.raise('staff-1', VALID, CLIENT)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PickupRequestStatus.FAILED }),
      }),
    );
  });

  it('records a courier refusal as FAILED rather than reporting success', async () => {
    const { svc, update } = make({
      requestPickupResult: {
        success: false,
        pickupId: null,
        message: 'Pickup already exists for this date',
      },
    });
    const out = await svc.raise('staff-1', VALID, CLIENT);
    expect(out.status).toBe(PickupRequestStatus.FAILED);
    expect(update).toHaveBeenCalled();
  });

  it('refuses an inactive warehouse — no van goes to a closed building', async () => {
    const { svc } = make({ warehouse: { status: WarehouseStatus.INACTIVE } });
    await expect(svc.raise('staff-1', VALID, CLIENT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when no pickup location is configured', async () => {
    // The name must match Delhivery's records exactly; guessing it
    // would fail at their end with a worse message.
    const { svc } = make({ pickupLocation: '   ' });
    await expect(svc.raise('staff-1', VALID, CLIENT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed date instead of sending it', async () => {
    const { svc } = make();
    await expect(
      svc.raise('staff-1', { ...VALID, pickupDate: '28-07-2026' }, CLIENT),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('snapshots the pickup location name that was actually sent', async () => {
    // The setting behind it can be edited later; the request should
    // record what went to the courier, not what the setting says today.
    const { svc, create } = make({ pickupLocation: 'Skydrop BLR' });
    await svc.raise('staff-1', VALID, CLIENT);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pickupLocationName: 'Skydrop BLR' }),
      }),
    );
  });
});

describe('CourierPickupService.releaseDay', () => {
  it('refuses to free a day the courier acknowledged', async () => {
    // A courier pickup id means the request exists on their side.
    // Freeing the slot here would let a second van be booked against a
    // live request — cancel it in their panel instead.
    const { svc, del } = make({
      existing: {
        id: REQUEST_ID,
        status: PickupRequestStatus.REQUESTED,
        warehouseId: WAREHOUSE_ID,
        pickupDate: new Date('2026-07-28T00:00:00.000Z'),
        courierPickupId: 'PU-1',
      },
    });
    await expect(
      svc.releaseDay('staff-1', REQUEST_ID, 'confirmed absent', CLIENT),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(del).not.toHaveBeenCalled();
  });

  it('frees a failed attempt the courier never acknowledged, auditing HIGH', async () => {
    const { svc, del, audit } = make({
      existing: {
        id: REQUEST_ID,
        status: PickupRequestStatus.FAILED,
        warehouseId: WAREHOUSE_ID,
        pickupDate: new Date('2026-07-28T00:00:00.000Z'),
        courierPickupId: null,
      },
    });
    const out = await svc.releaseDay(
      'staff-1',
      REQUEST_ID,
      'checked the One panel, nothing registered',
      CLIENT,
    );
    expect(out.released).toBe(true);
    expect(del).toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.pickup.day_released',
        severity: 'HIGH',
      }),
    );
  });

  it('404s on an unknown request', async () => {
    const { svc } = make({ existing: null });
    await expect(
      svc.releaseDay('staff-1', REQUEST_ID, 'some reason here', CLIENT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
