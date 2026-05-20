import { NotFoundException } from '@nestjs/common';
import { ActorType, ManifestStatus, ShipmentStatus } from '@skydrop/db';
import { ManifestService } from '../../src/modules/warehouse-manifest/services/manifest.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ManifestNumberingService } from '../../src/modules/warehouse-manifest/services/manifest-numbering.service';

type AnyArgs = Record<string, unknown>;

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

  const svc = new ManifestService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    numbering as unknown as ManifestNumberingService,
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
    const svc = new ManifestService(
      { client } as unknown as PrismaService,
      audit as unknown as AuditLogService,
      numbering as unknown as ManifestNumberingService,
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
