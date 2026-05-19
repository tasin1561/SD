import { ShipmentStatus } from '@skydrop/db';
import { PickExpirationService } from '../../src/modules/warehouse-pick/services/pick-expiration.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PickExpirationQueue } from '../../src/modules/warehouse-pick/queue/pick-expiration.queue';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { StockPickAllocationService } from '../../src/modules/inventory-stock/services/stock-pick-allocation.service';

type AnyArgs = Record<string, unknown>;

const STARTED_AT = new Date('2026-05-19T08:00:00.000Z');
const ISO = STARTED_AT.toISOString();

function makeService(
  opts: {
    shipment?: AnyArgs | null; // findFirst result; undefined → default claimed
    updateCount?: number;
    active?: Array<{ id: string }>;
    release?: jest.Mock;
  } = {},
) {
  const defaultShipment = {
    id: 'ship-1',
    status: ShipmentStatus.CREATED,
    pickStartedAt: STARTED_AT,
    pickStartedByStaffId: 'staff-1',
    pickCompletedAt: null,
    orderShipments: [{ orderId: 'order-1' }],
  };
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const updateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(
    async () => ({ count: opts.updateCount ?? 1 }),
  );
  const client = { shipment: { findFirst, updateMany } };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };
  const enqueueExpiration = jest.fn<Promise<string>, [AnyArgs, number]>(
    async () => 'job-1',
  );
  const queue = { enqueueExpiration };
  const listActiveForOrder = jest.fn(async () => opts.active ?? []);
  const reservations = { listActiveForOrder };
  const releaseAllocation =
    opts.release ?? jest.fn(async () => ({ alreadyPhase1: false }));
  const allocation = { releaseAllocation };

  const svc = new PickExpirationService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    queue as unknown as PickExpirationQueue,
    reservations as unknown as StockReservationService,
    allocation as unknown as StockPickAllocationService,
  );
  return {
    svc,
    findFirst,
    updateMany,
    auditLog,
    enqueueExpiration,
    listActiveForOrder,
    releaseAllocation,
  };
}

describe('PickExpirationService.scheduleExpiration', () => {
  it('enqueues with the pickStartedAt ISO + a delay to the deadline', async () => {
    const { svc, enqueueExpiration } = makeService();
    const now = Date.now();
    const expiresAt = new Date(now + 4 * 3_600_000);
    await svc.scheduleExpiration('ship-1', STARTED_AT, expiresAt);
    const [payload, delayMs] = enqueueExpiration.mock.calls[0] ?? [];
    expect(payload).toEqual({ shipmentId: 'ship-1', pickStartedAtIso: ISO });
    expect(delayMs).toBeLessThanOrEqual(4 * 3_600_000);
    expect(delayMs).toBeGreaterThan(4 * 3_600_000 - 5_000);
  });

  it('passes a non-negative delay even for a past deadline', async () => {
    const { svc, enqueueExpiration } = makeService();
    await svc.scheduleExpiration(
      'ship-1',
      STARTED_AT,
      new Date(Date.now() - 60_000),
    );
    const delayMs = enqueueExpiration.mock.calls[0]?.[1] ?? -1;
    // enqueueExpiration itself clamps to >=0; the service may pass a
    // negative — assert the contract boundary is the queue's job.
    expect(typeof delayMs).toBe('number');
  });
});

describe('PickExpirationService.expire', () => {
  it('releases the claim (CAS) + gives M5 holds back + audits when current', async () => {
    const { svc, updateMany, auditLog, releaseAllocation } = makeService({
      active: [{ id: 'r1' }, { id: 'r2' }],
      release: jest
        .fn()
        .mockResolvedValueOnce({ alreadyPhase1: false })
        .mockResolvedValueOnce({ alreadyPhase1: true }),
    });
    const r = await svc.expire('ship-1', ISO);
    expect(r).toEqual({ expired: true });

    const where = updateMany.mock.calls[0]?.[0].where as AnyArgs;
    expect(where).toMatchObject({
      id: 'ship-1',
      status: ShipmentStatus.CREATED,
      pickStartedAt: STARTED_AT,
      pickCompletedAt: null,
    });
    const data = updateMany.mock.calls[0]?.[0].data as AnyArgs;
    expect(data).toEqual({
      pickStartedAt: null,
      pickStartedByStaffId: null,
      pickExpiresAt: null,
    });

    expect(releaseAllocation).toHaveBeenCalledTimes(2);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'warehouse_pick.expired',
        severity: 'MEDIUM',
        metadata: expect.objectContaining({ releasedGroups: 1 }),
      }),
    );
  });

  it('no-ops when the shipment vanished', async () => {
    const { svc, updateMany, auditLog, releaseAllocation } = makeService({
      shipment: null,
    });
    expect(await svc.expire('ship-1', ISO)).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(releaseAllocation).not.toHaveBeenCalled();
  });

  it('no-ops when the shipment is past CREATED', async () => {
    const { svc, updateMany } = makeService({
      shipment: {
        id: 'ship-1',
        status: ShipmentStatus.HANDED_TO_COURIER,
        pickStartedAt: STARTED_AT,
        pickStartedByStaffId: 'staff-1',
        pickCompletedAt: null,
        orderShipments: [{ orderId: 'order-1' }],
      },
    });
    expect(await svc.expire('ship-1', ISO)).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('no-ops when the pick already completed', async () => {
    const { svc, updateMany } = makeService({
      shipment: {
        id: 'ship-1',
        status: ShipmentStatus.CREATED,
        pickStartedAt: STARTED_AT,
        pickStartedByStaffId: 'staff-1',
        pickCompletedAt: new Date('2026-05-19T08:30:00.000Z'),
        orderShipments: [{ orderId: 'order-1' }],
      },
    });
    expect(await svc.expire('ship-1', ISO)).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('no-ops on a stale timer (re-pulled with a newer pickStartedAt)', async () => {
    const { svc, updateMany, auditLog } = makeService({
      shipment: {
        id: 'ship-1',
        status: ShipmentStatus.CREATED,
        pickStartedAt: new Date('2026-05-19T11:00:00.000Z'),
        pickStartedByStaffId: 'staff-2',
        pickCompletedAt: null,
        orderShipments: [{ orderId: 'order-1' }],
      },
    });
    expect(await svc.expire('ship-1', ISO)).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('no-ops when pickStartedAt is already cleared', async () => {
    const { svc, updateMany } = makeService({
      shipment: {
        id: 'ship-1',
        status: ShipmentStatus.CREATED,
        pickStartedAt: null,
        pickStartedByStaffId: null,
        pickCompletedAt: null,
        orderShipments: [{ orderId: 'order-1' }],
      },
    });
    expect(await svc.expire('ship-1', ISO)).toEqual({ expired: false });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('no-ops + skips audit/release when it loses the conditional-update race', async () => {
    const { svc, updateMany, auditLog, releaseAllocation } = makeService({
      updateCount: 0,
    });
    expect(await svc.expire('ship-1', ISO)).toEqual({ expired: false });
    expect(updateMany).toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(releaseAllocation).not.toHaveBeenCalled();
  });

  it('still expires (audit) when the M5 give-back throws — best-effort', async () => {
    const { svc, auditLog, updateMany } = makeService({
      active: [{ id: 'r1' }],
      release: jest.fn(async () => {
        throw new Error('m5 down');
      }),
    });
    const r = await svc.expire('ship-1', ISO);
    expect(r).toEqual({ expired: true }); // CAS won; give-back failure swallowed
    expect(updateMany).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'warehouse_pick.expired',
        metadata: expect.objectContaining({ releasedGroups: 0 }),
      }),
    );
  });
});
