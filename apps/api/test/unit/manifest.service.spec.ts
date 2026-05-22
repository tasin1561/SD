import { NotFoundException } from '@nestjs/common';
import { ActorType, ManifestStatus, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { ManifestService } from '../../src/modules/warehouse-manifest/services/manifest.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ManifestNumberingService } from '../../src/modules/warehouse-manifest/services/manifest-numbering.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { AwbGenerationQueue } from '../../src/modules/courier-awb/queue/awb-generation.queue';

type AnyArgs = Record<string, unknown>;

/** Shared AWB-queue mock factory — close() enqueues the AWB job. */
function makeAwbQueue(): {
  awbQueue: AwbGenerationQueue;
  enqueueManifest: jest.Mock;
} {
  const enqueueManifest = jest.fn(async () => 'awb-job-1');
  return {
    awbQueue: { enqueueManifest } as unknown as AwbGenerationQueue,
    enqueueManifest,
  };
}

const COURIER = 'delhivery';
const WAREHOUSE = 'wh-1';
const SHIP = 'ship-1';
const PACKED_AT = new Date('2026-05-19T11:00:00.000Z');

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    existingDraft?: AnyArgs | null;
  } = {},
) {
  const defaultShipment = {
    id: SHIP,
    status: ShipmentStatus.CREATED,
    courierCode: COURIER,
    originWarehouseId: WAREHOUSE,
    packCompletedAt: PACKED_AT,
    manifestId: null,
    manifest: null,
  };
  const shipmentFindFirst = jest.fn(async () =>
    opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const manifestFindFirst = jest.fn(async () =>
    opts.existingDraft === undefined ? null : opts.existingDraft,
  );
  const manifestCreate = jest.fn(async () => ({
    id: 'man-new',
    manifestNumber: 'MF-2026-05-000001',
  }));
  const shipmentUpdate = jest.fn(async () => ({}));
  const executeRawUnsafe = jest.fn<Promise<number>, [string, ...unknown[]]>(
    async () => 1,
  );

  const txClient = {
    $executeRawUnsafe: executeRawUnsafe,
    manifest: { findFirst: manifestFindFirst, create: manifestCreate },
    shipment: { update: shipmentUpdate },
  };
  const client = {
    shipment: { findFirst: shipmentFindFirst },
  } as {
    shipment: { findFirst: typeof shipmentFindFirst };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn(txClient);

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown]>(
    async () => 'a',
  );
  const audit = { log: auditLog };
  const nextManifestNumber = jest.fn(async () => 'MF-2026-05-000001');
  const numbering = { nextManifestNumber };
  const transitionStatus = jest.fn(async () => ({ status: 'PACKED' }));
  const orderWrite = { transitionStatus };

  const svc = new ManifestService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    numbering as unknown as ManifestNumberingService,
    orderWrite as unknown as OrderWriteService,
    makeAwbQueue().awbQueue,
  );
  return {
    svc,
    shipmentFindFirst,
    manifestFindFirst,
    manifestCreate,
    shipmentUpdate,
    auditLog,
    executeRawUnsafe,
    nextManifestNumber,
    transitionStatus,
  };
}

describe('ManifestService.attachShipment', () => {
  it('creates a new DRAFT manifest when none exists for (courier, warehouse)', async () => {
    const { svc, manifestCreate, shipmentUpdate, auditLog, nextManifestNumber } =
      makeService();
    const r = await svc.attachShipment(SHIP, {
      type: ActorType.STAFF,
      id: 'staff-1',
    });
    expect(r).toEqual({
      shipmentId: SHIP,
      manifestId: 'man-new',
      manifestNumber: 'MF-2026-05-000001',
      manifestCreated: true,
      alreadyAttached: false,
    });
    expect(nextManifestNumber).toHaveBeenCalled();
    expect(manifestCreate).toHaveBeenCalled();
    expect(shipmentUpdate).toHaveBeenCalledWith({
      where: { id: SHIP },
      data: { manifestId: 'man-new' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manifest.shipment_attached' }),
      expect.anything(),
    );
  });

  it('reuses an existing DRAFT manifest for the same (courier, warehouse)', async () => {
    const { svc, manifestCreate, shipmentUpdate, nextManifestNumber } =
      makeService({
        existingDraft: { id: 'man-existing', manifestNumber: 'MF-2026-05-000099' },
      });
    const r = await svc.attachShipment(SHIP);
    expect(r).toMatchObject({
      manifestId: 'man-existing',
      manifestNumber: 'MF-2026-05-000099',
      manifestCreated: false,
      alreadyAttached: false,
    });
    expect(manifestCreate).not.toHaveBeenCalled();
    expect(nextManifestNumber).not.toHaveBeenCalled();
    expect(shipmentUpdate).toHaveBeenCalled();
  });

  it('idempotent: shipment already attached to a matching DRAFT → no-op', async () => {
    const { svc, manifestCreate, shipmentUpdate, manifestFindFirst } =
      makeService({
        shipment: {
          id: SHIP,
          status: ShipmentStatus.CREATED,
          courierCode: COURIER,
          originWarehouseId: WAREHOUSE,
          packCompletedAt: PACKED_AT,
          manifestId: 'man-existing',
          manifest: {
            id: 'man-existing',
            status: ManifestStatus.DRAFT,
            courierCode: COURIER,
            originWarehouseId: WAREHOUSE,
            manifestNumber: 'MF-2026-05-000007',
          },
        },
      });
    const r = await svc.attachShipment(SHIP);
    expect(r).toEqual({
      shipmentId: SHIP,
      manifestId: 'man-existing',
      manifestNumber: 'MF-2026-05-000007',
      manifestCreated: false,
      alreadyAttached: true,
    });
    expect(manifestFindFirst).not.toHaveBeenCalled();
    expect(manifestCreate).not.toHaveBeenCalled();
    expect(shipmentUpdate).not.toHaveBeenCalled();
  });

  it('404 when shipment not found', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.attachShipment(SHIP)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409 SHIPMENT_NOT_ATTACHABLE when status past CREATED', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.HANDED_TO_COURIER,
        courierCode: COURIER,
        originWarehouseId: WAREHOUSE,
        packCompletedAt: PACKED_AT,
        manifestId: null,
        manifest: null,
      },
    });
    await expect(svc.attachShipment(SHIP)).rejects.toMatchObject({
      response: { code: 'SHIPMENT_NOT_ATTACHABLE' },
    });
  });

  it('409 SHIPMENT_NOT_PACKED when packCompletedAt null', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        courierCode: COURIER,
        originWarehouseId: WAREHOUSE,
        packCompletedAt: null,
        manifestId: null,
        manifest: null,
      },
    });
    await expect(svc.attachShipment(SHIP)).rejects.toMatchObject({
      response: { code: 'SHIPMENT_NOT_PACKED' },
    });
  });

  it('409 MANIFEST_CLOSED when shipment is already on a CLOSED manifest', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        courierCode: COURIER,
        originWarehouseId: WAREHOUSE,
        packCompletedAt: PACKED_AT,
        manifestId: 'man-closed',
        manifest: {
          id: 'man-closed',
          status: ManifestStatus.CLOSED,
          courierCode: COURIER,
          originWarehouseId: WAREHOUSE,
          manifestNumber: 'MF-2026-05-000050',
        },
      },
    });
    await expect(svc.attachShipment(SHIP)).rejects.toMatchObject({
      response: { code: 'MANIFEST_CLOSED' },
    });
  });
});

describe('ManifestService.moveShipment', () => {
  const SRC = 'man-src';
  const TGT = 'man-tgt';
  const draftSrc = {
    id: SRC,
    status: ManifestStatus.DRAFT,
    manifestNumber: 'MF-2026-05-000001',
    courierCode: COURIER,
    originWarehouseId: WAREHOUSE,
  };

  function makeMoveService(
    opts: {
      shipment?: AnyArgs | null;
      target?: AnyArgs | null;
    } = {},
  ) {
    const defaultShipment = {
      id: SHIP,
      status: ShipmentStatus.CREATED,
      courierCode: COURIER,
      originWarehouseId: WAREHOUSE,
      packCompletedAt: PACKED_AT,
      manifestId: SRC,
      manifest: draftSrc,
    };
    const shipmentFindFirst = jest.fn(async () =>
      opts.shipment === undefined ? defaultShipment : opts.shipment,
    );
    const manifestFindUnique = jest.fn(async () =>
      opts.target === undefined
        ? {
            id: TGT,
            status: ManifestStatus.DRAFT,
            manifestNumber: 'MF-2026-05-000002',
            courierCode: COURIER,
            originWarehouseId: WAREHOUSE,
          }
        : opts.target,
    );
    const shipmentUpdate = jest.fn(async () => ({}));
    const txClient = { shipment: { update: shipmentUpdate } };
    const client = {
      shipment: { findFirst: shipmentFindFirst },
      manifest: { findUnique: manifestFindUnique },
    } as {
      shipment: { findFirst: typeof shipmentFindFirst };
      manifest: { findUnique: typeof manifestFindUnique };
      $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    };
    client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(txClient);
    const auditLog = jest.fn(async () => 'a');
    const audit = { log: auditLog };
    const nextManifestNumber = jest.fn(async () => 'MF-2026-05-000099');
    const numbering = { nextManifestNumber };
    const transitionStatus = jest.fn(async () => ({ status: 'PACKED' }));
    const orderWrite = { transitionStatus };
    const svc = new ManifestService(
      { client } as unknown as PrismaService,
      audit as unknown as AuditLogService,
      numbering as unknown as ManifestNumberingService,
      orderWrite as unknown as OrderWriteService,
      makeAwbQueue().awbQueue,
    );
    return { svc, shipmentFindFirst, manifestFindUnique, shipmentUpdate, auditLog };
  }

  it('moves DRAFT → DRAFT (same courier+warehouse) + audit MEDIUM', async () => {
    const { svc, shipmentUpdate, auditLog } = makeMoveService();
    const r = await svc.moveShipment(SHIP, TGT);
    expect(r).toEqual({
      shipmentId: SHIP,
      sourceManifestId: SRC,
      targetManifestId: TGT,
      alreadyOnTarget: false,
    });
    expect(shipmentUpdate).toHaveBeenCalledWith({
      where: { id: SHIP },
      data: { manifestId: TGT },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'manifest.shipment_moved',
        severity: 'MEDIUM',
      }),
      expect.anything(),
    );
  });

  it('idempotent: already on target → no-op (no update, no audit)', async () => {
    const { svc, shipmentUpdate, auditLog } = makeMoveService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        courierCode: COURIER,
        originWarehouseId: WAREHOUSE,
        packCompletedAt: PACKED_AT,
        manifestId: TGT,
        manifest: { ...draftSrc, id: TGT },
      },
    });
    const r = await svc.moveShipment(SHIP, TGT);
    expect(r.alreadyOnTarget).toBe(true);
    expect(shipmentUpdate).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects SOURCE_MANIFEST_CLOSED', async () => {
    const { svc } = makeMoveService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        courierCode: COURIER,
        originWarehouseId: WAREHOUSE,
        packCompletedAt: PACKED_AT,
        manifestId: SRC,
        manifest: { ...draftSrc, status: ManifestStatus.CLOSED },
      },
    });
    await expect(svc.moveShipment(SHIP, TGT)).rejects.toMatchObject({
      response: { code: 'SOURCE_MANIFEST_CLOSED' },
    });
  });

  it('rejects TARGET_MANIFEST_NOT_DRAFT (CLOSED target)', async () => {
    const { svc } = makeMoveService({
      target: {
        id: TGT,
        status: ManifestStatus.CLOSED,
        manifestNumber: 'MF-X',
        courierCode: COURIER,
        originWarehouseId: WAREHOUSE,
      },
    });
    await expect(svc.moveShipment(SHIP, TGT)).rejects.toMatchObject({
      response: { code: 'TARGET_MANIFEST_NOT_DRAFT' },
    });
  });

  it('404 when target manifest is missing', async () => {
    const { svc } = makeMoveService({ target: null });
    await expect(svc.moveShipment(SHIP, TGT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects COURIER_MISMATCH', async () => {
    const { svc } = makeMoveService({
      target: {
        id: TGT,
        status: ManifestStatus.DRAFT,
        manifestNumber: 'MF-X',
        courierCode: 'bluedart',
        originWarehouseId: WAREHOUSE,
      },
    });
    await expect(svc.moveShipment(SHIP, TGT)).rejects.toMatchObject({
      response: { code: 'COURIER_MISMATCH' },
    });
  });

  it('rejects WAREHOUSE_MISMATCH', async () => {
    const { svc } = makeMoveService({
      target: {
        id: TGT,
        status: ManifestStatus.DRAFT,
        manifestNumber: 'MF-X',
        courierCode: COURIER,
        originWarehouseId: 'wh-2',
      },
    });
    await expect(svc.moveShipment(SHIP, TGT)).rejects.toMatchObject({
      response: { code: 'WAREHOUSE_MISMATCH' },
    });
  });

  it('rejects SHIPMENT_NOT_ATTACHED when manifestId is null', async () => {
    const { svc } = makeMoveService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        courierCode: COURIER,
        originWarehouseId: WAREHOUSE,
        packCompletedAt: PACKED_AT,
        manifestId: null,
        manifest: null,
      },
    });
    await expect(svc.moveShipment(SHIP, TGT)).rejects.toMatchObject({
      response: { code: 'SHIPMENT_NOT_ATTACHED' },
    });
  });
});

describe('ManifestService.close', () => {
  const MAN = 'man-1';

  function makeCloseService(
    opts: {
      manifest?: AnyArgs | null;
      transitionResults?: Array<{ ok: true } | { ok: false; err: string }>;
      updateCount?: number;
    } = {},
  ) {
    const defaultManifest = {
      id: MAN,
      manifestNumber: 'MF-2026-05-000001',
      status: ManifestStatus.DRAFT,
      closedAt: null,
      closedByStaffId: null,
      shipments: [
        {
          id: 's1',
          status: ShipmentStatus.CREATED,
          orderShipments: [{ orderId: 'o1' }],
        },
        {
          id: 's2',
          status: ShipmentStatus.CREATED,
          orderShipments: [{ orderId: 'o2' }],
        },
      ],
    };
    const manifestFindUnique = jest.fn(async () =>
      opts.manifest === undefined ? defaultManifest : opts.manifest,
    );
    const manifestUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(
      async () => ({ count: opts.updateCount ?? 1 }),
    );
    const txClient = { manifest: { updateMany: manifestUpdateMany } };
    const client = {
      manifest: { findUnique: manifestFindUnique },
    } as {
      manifest: { findUnique: typeof manifestFindUnique };
      $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    };
    client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(txClient);

    const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(
      async () => 'a',
    );
    const audit = { log: auditLog };
    const nextManifestNumber = jest.fn(async () => 'MF-X');
    const numbering = { nextManifestNumber };

    const results = opts.transitionResults ?? [{ ok: true }, { ok: true }];
    let txIdx = 0;
    const transitionStatus = jest.fn(async () => {
      const r = results[txIdx++];
      if (r && !r.ok) throw new Error(r.err);
      return { status: OrderStatus.PENDING_DISPATCH };
    });
    const orderWrite = { transitionStatus };

    const { awbQueue, enqueueManifest } = makeAwbQueue();
    const svc = new ManifestService(
      { client } as unknown as PrismaService,
      audit as unknown as AuditLogService,
      numbering as unknown as ManifestNumberingService,
      orderWrite as unknown as OrderWriteService,
      awbQueue,
    );
    return { svc, manifestUpdateMany, transitionStatus, auditLog, enqueueManifest };
  }

  it('happy: closes DRAFT + transitions each shipment + enqueues the AWB job', async () => {
    const { svc, manifestUpdateMany, transitionStatus, enqueueManifest } =
      makeCloseService();
    const r = await svc.close(MAN, 'sup-1');
    expect(r.status).toBe(ManifestStatus.CLOSED);
    expect(r.alreadyClosed).toBe(false);
    expect(r.shipmentIds).toEqual(['s1', 's2']);
    expect(r.transitionedCount).toBe(2);
    expect(r.failures).toEqual([]);

    expect(manifestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MAN, status: ManifestStatus.DRAFT },
        data: expect.objectContaining({
          status: ManifestStatus.CLOSED,
          closedByStaffId: 'sup-1',
          awbJobEnqueuedAt: expect.any(Date),
        }),
      }),
    );
    expect(transitionStatus).toHaveBeenCalledTimes(2);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.PENDING_DISPATCH,
        expectedFrom: OrderStatus.PACKED,
      }),
    );
    // M9 commit 10: the AWB job is enqueued (replaces the M8 audit stub).
    expect(enqueueManifest).toHaveBeenCalledWith(MAN);
  });

  it('idempotent: already CLOSED → no transitions, no AWB enqueue, alreadyClosed:true', async () => {
    const closedAt = new Date('2026-05-19T15:00:00Z');
    const { svc, manifestUpdateMany, transitionStatus, auditLog, enqueueManifest } =
      makeCloseService({
        manifest: {
          id: MAN,
          manifestNumber: 'MF-2026-05-000001',
          status: ManifestStatus.CLOSED,
          closedAt,
          closedByStaffId: 'prev-sup',
          shipments: [
            { id: 's1', status: ShipmentStatus.CREATED, orderShipments: [{ orderId: 'o1' }] },
          ],
        },
      });
    const r = await svc.close(MAN, 'sup-1');
    expect(r).toEqual({
      manifestId: MAN,
      manifestNumber: 'MF-2026-05-000001',
      status: ManifestStatus.CLOSED,
      closedAt,
      closedByStaffId: 'prev-sup',
      shipmentIds: ['s1'],
      transitionedCount: 0,
      failures: [],
      alreadyClosed: true,
    });
    expect(manifestUpdateMany).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(enqueueManifest).not.toHaveBeenCalled();
  });

  it('rejects MANIFEST_EMPTY when manifest has no shipments', async () => {
    const { svc } = makeCloseService({
      manifest: {
        id: MAN,
        manifestNumber: 'MF-X',
        status: ManifestStatus.DRAFT,
        closedAt: null,
        closedByStaffId: null,
        shipments: [],
      },
    });
    await expect(svc.close(MAN, 'sup-1')).rejects.toMatchObject({
      response: { code: 'MANIFEST_EMPTY' },
    });
  });

  it('404 when manifest is missing', async () => {
    const { svc } = makeCloseService({ manifest: null });
    await expect(svc.close(MAN, 'sup-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('partial transition failure: manifest still CLOSED, failures collected, AWB job still enqueued', async () => {
    const { svc, enqueueManifest } = makeCloseService({
      transitionResults: [{ ok: true }, { ok: false, err: 'INVALID_TRANSITION' }],
    });
    const r = await svc.close(MAN, 'sup-1');
    expect(r.status).toBe(ManifestStatus.CLOSED);
    expect(r.transitionedCount).toBe(1);
    expect(r.failures).toEqual([
      { shipmentId: 's2', orderId: 'o2', error: 'INVALID_TRANSITION' },
    ]);
    // The AWB job is still enqueued — the manifest IS closed; a
    // per-shipment transition failure does not undo the closure.
    expect(enqueueManifest).toHaveBeenCalledWith(MAN);
  });

  it('race: 409 MANIFEST_CLOSE_RACE when updateMany count=0', async () => {
    const { svc, transitionStatus } = makeCloseService({ updateCount: 0 });
    await expect(svc.close(MAN, 'sup-1')).rejects.toMatchObject({
      response: { code: 'MANIFEST_CLOSE_RACE' },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});

describe('ManifestService.attachShipment — advisory lock', () => {
  it('takes the (courier, warehouse) advisory lock inside the create tx', async () => {
    const { svc, executeRawUnsafe } = makeService();
    await svc.attachShipment(SHIP);
    const lockCall = executeRawUnsafe.mock.calls.find((c) =>
      String(c[0]).includes('pg_advisory_xact_lock'),
    );
    expect(lockCall).toBeDefined();
    // namespace + js-hashed key.
    expect(lockCall?.[1]).toBe(0x0_4d_47);
    expect(typeof lockCall?.[2]).toBe('number');
  });
});
