import { NotFoundException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PackService } from '../../src/modules/warehouse-pack/services/pack.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { ManifestService } from '../../src/modules/warehouse-manifest/services/manifest.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';
import type { CourierPickupService } from '../../src/modules/courier-ops/services/courier-pickup.service';

type AnyArgs = Record<string, unknown>;

const SHIP = 'ship-1';
const ORDER = 'order-1';
const STAFF = 'staff-1';

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    orderStatus?: OrderStatus | 'missing';
    stampCount?: number;
    attach?: jest.Mock;
    /** R4: how many PICKED serialized units the parcel carries. >0 turns
     *  the strict pack gate on. */
    pickedUnits?: number;
    raiseIfDue?: jest.Mock;
  } = {},
) {
  const defaultShipment = {
    id: SHIP,
    status: ShipmentStatus.CREATED,
    packCompletedAt: null,
    manifestId: null,
    manifest: null,
    courierCode: 'delhivery',
    isManualCourier: false,
    courierAccountId: null,
    originWarehouseId: 'wh-1',
    orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
  };
  const shipmentFindFirst = jest.fn(async () =>
    opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.stampCount ?? 1,
  }));
  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    shipment: { findFirst: shipmentFindFirst, updateMany: shipmentUpdateMany },
  };

  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : { orderId: ORDER, status: opts.orderStatus ?? OrderStatus.PICKED },
  );
  const orders = { getById };
  const transitionStatus = jest.fn(async () => ({
    orderId: ORDER,
    status: OrderStatus.PACKED,
  }));
  const orderWrite = { transitionStatus };
  const attachShipment =
    opts.attach ??
    jest.fn(async () => ({
      shipmentId: SHIP,
      manifestId: 'man-1',
      manifestNumber: 'MF-2026-05-000001',
      manifestCreated: true,
      alreadyAttached: false,
    }));
  const manifests = { attachShipment };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  // R4: NORMAL-mode fixtures — no serialized units exist, so the unit
  // ledger is a no-op here. countForShipment returning 0 is what makes
  // the strict gate skip; parcel-grained advances move nothing.
  const unitLedger = {
    countForShipment: jest.fn(async () => opts.pickedUnits ?? 0),
    advanceUnitsForShipment: jest.fn(async () => 0),
    scanUnits: jest.fn(async () => []),
    scanUnitsForShipment: jest.fn<Promise<number>, [unknown, AnyArgs]>(
      async () => opts.pickedUnits ?? 0,
    ),
  };
  const raiseIfDue =
    opts.raiseIfDue ??
    jest.fn(async () => ({ fired: false, reason: 'AUTO_PICKUP_DISABLED', requestId: null }));
  const pickups = { raiseIfDue };
  const svc = new PackService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    manifests as unknown as ManifestService,
    unitLedger as unknown as StockUnitService,
    pickups as unknown as CourierPickupService,
  );
  return {
    svc,
    shipmentFindFirst,
    shipmentUpdateMany,
    getById,
    transitionStatus,
    raiseIfDue,
    attachShipment,
    auditLog,
    unitLedger,
  };
}

describe('PackService.complete', () => {
  it('happy path: stamp → PICKED→PACKED → attach to NEW DRAFT manifest', async () => {
    const { svc, shipmentUpdateMany, transitionStatus, attachShipment } = makeService();
    const r = await svc.complete(SHIP, STAFF);

    // Stamp BEFORE transition (operational write first).
    const stampOrd = shipmentUpdateMany.mock.invocationCallOrder[0] ?? 0;
    const transOrd = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(stampOrd).toBeLessThan(transOrd);

    expect(shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SHIP,
          status: ShipmentStatus.CREATED,
          packCompletedAt: null,
        }),
        data: expect.objectContaining({ packedByStaffId: STAFF }),
      }),
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.PACKED,
        expectedFrom: OrderStatus.PICKED,
      }),
    );
    expect(attachShipment).toHaveBeenCalledWith(SHIP, expect.anything(), undefined);
    expect(r).toMatchObject({
      status: OrderStatus.PACKED,
      manifestId: 'man-1',
      manifestNumber: 'MF-2026-05-000001',
      unitsScanned: 0,
      alreadyComplete: false,
    });
  });

  it('idempotent: already PACKED + stamped → no-op (no transition, no attach)', async () => {
    const packedAt = new Date('2026-05-19T12:00:00Z');
    const { svc, transitionStatus, attachShipment, shipmentUpdateMany } = makeService({
      orderStatus: OrderStatus.PACKED,
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        packCompletedAt: packedAt,
        manifestId: 'man-1',
        manifest: { manifestNumber: 'MF-2026-05-000001' },
        orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
      },
    });
    const r = await svc.complete(SHIP, STAFF);
    expect(r).toEqual({
      shipmentId: SHIP,
      orderId: ORDER,
      status: OrderStatus.PACKED,
      packCompletedAt: packedAt,
      manifestId: 'man-1',
      manifestNumber: 'MF-2026-05-000001',
      unitsScanned: 0,
      alreadyComplete: true,
    });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(attachShipment).not.toHaveBeenCalled();
  });

  it('STRICT: a parcel carrying serialized units cannot be packed without scans — and the claim is NOT consumed', async () => {
    const { svc, shipmentUpdateMany, transitionStatus } = makeService({
      pickedUnits: 2,
    });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'UNIT_SCAN_REQUIRED' },
    });
    // The gate runs BEFORE the operational stamp on purpose: a mis-scanned
    // box must stay packable by whoever fixes it.
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('STRICT: scanning the parcel moves its units and reports the count', async () => {
    const { svc, unitLedger } = makeService({ pickedUnits: 2 });
    const r = await svc.complete(SHIP, STAFF, undefined, ['S1', 'S2']);
    expect(r.unitsScanned).toBe(2);
    expect(unitLedger.scanUnitsForShipment).toHaveBeenCalledTimes(1);
    const args = unitLedger.scanUnitsForShipment.mock.calls[0]![1];
    expect(args).toMatchObject({ gate: 'PACK', serials: ['S1', 'S2'] });
  });

  it('NORMAL: an all-normal parcel packs with no scans at all', async () => {
    const { svc, unitLedger } = makeService();
    const r = await svc.complete(SHIP, STAFF);
    expect(r.unitsScanned).toBe(0);
    expect(unitLedger.scanUnitsForShipment).not.toHaveBeenCalled();
  });

  it('rejects ORDER_NOT_PACKABLE when order is not PICKED', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.CONFIRMED });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_PACKABLE' },
    });
  });

  it('rejects SHIPMENT_NOT_PACKABLE when shipment past CREATED', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.HANDED_TO_COURIER,
        packCompletedAt: null,
        manifestId: null,
        manifest: null,
        orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
      },
    });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'SHIPMENT_NOT_PACKABLE' },
    });
  });

  it('race: PACK_NOT_AVAILABLE when updateMany count=0', async () => {
    const { svc, transitionStatus, attachShipment } = makeService({
      stampCount: 0,
    });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'PACK_NOT_AVAILABLE' },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(attachShipment).not.toHaveBeenCalled();
  });

  it('best-effort: attach failure is swallowed, return manifestId null', async () => {
    const attach = jest.fn(async () => {
      throw new Error('manifest temp down');
    });
    const { svc } = makeService({ attach });
    const r = await svc.complete(SHIP, STAFF);
    expect(r).toMatchObject({
      status: OrderStatus.PACKED,
      manifestId: null,
      manifestNumber: null,
      unitsScanned: 0,
      alreadyComplete: false,
    });
  });

  it('404 when shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.complete(SHIP, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 when order is missing', async () => {
    const { svc } = makeService({ orderStatus: 'missing' });
    await expect(svc.complete(SHIP, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------
// The auto-pickup hook (CUR-10's per-category switch).
//
// Packing a box completing is not itself a courier call — it ASKS
// whether one is due, and `raiseIfDue` is the sole decision-maker on
// whether that turns into a real request. This suite only pins the
// PLUMBING: that the hook fires with the right shipment facts, that a
// manual courier is skipped before it ever reaches that decision, and
// that a failure there can never fail the pack.
// ---------------------------------------------------------------------
describe('PackService.complete — the auto-pickup hook', () => {
  it('asks raiseIfDue with the shipment that was just packed', async () => {
    const raiseIfDue = jest.fn(async () => ({
      fired: true,
      reason: 'REQUESTED',
      requestId: 'pr-1',
    }));
    const { svc } = makeService({ raiseIfDue });
    await svc.complete(SHIP, STAFF);
    expect(raiseIfDue).toHaveBeenCalledWith({
      warehouseId: 'wh-1',
      courierCode: 'delhivery',
      courierAccountId: null,
      triggeredByShipmentId: SHIP,
    });
  });

  it('never asks for a MANUAL courier — there is no account to ask', async () => {
    const raiseIfDue = jest.fn();
    const { svc } = makeService({
      raiseIfDue,
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        packCompletedAt: null,
        manifestId: null,
        manifest: null,
        courierCode: 'manual',
        isManualCourier: true,
        courierAccountId: null,
        originWarehouseId: 'wh-1',
        orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
      },
    });
    await svc.complete(SHIP, STAFF);
    expect(raiseIfDue).not.toHaveBeenCalled();
  });

  it('a failure asking for pickup never fails the pack', async () => {
    // Best-effort, exactly like the WMS-7 manifest auto-attach beside
    // it: the parcel is correctly PACKED either way.
    const raiseIfDue = jest.fn(async () => {
      throw new Error('delhivery is down');
    });
    const { svc } = makeService({ raiseIfDue });
    const r = await svc.complete(SHIP, STAFF);
    expect(r.status).toBe(OrderStatus.PACKED);
    expect(r.alreadyComplete).toBe(false);
  });

  it('fires independently of whether the manifest auto-attach succeeded', async () => {
    // A van is asked for because a parcel is ready to leave the
    // building, not because of which paperwork it landed on.
    const attach = jest.fn(async () => {
      throw new Error('manifest attach failed');
    });
    const raiseIfDue = jest.fn(async () => ({
      fired: true,
      reason: 'REQUESTED',
      requestId: 'pr-1',
    }));
    const { svc } = makeService({ attach, raiseIfDue });
    await svc.complete(SHIP, STAFF);
    expect(raiseIfDue).toHaveBeenCalled();
  });
});
