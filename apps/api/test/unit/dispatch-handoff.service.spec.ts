import { NotFoundException } from '@nestjs/common';
import { ManifestStatus, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { DispatchHandoffService } from '../../src/modules/courier-dispatch/services/dispatch-handoff.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';

type AnyArgs = Record<string, unknown>;
const MAN = 'man-1';
const STAFF = 'sup-1';

function makeService(
  opts: {
    manifestStatus?: ManifestStatus;
    shipments?: Array<{ id: string; orderId: string | null; handoverScannedAt?: Date | null }>;
    handoverScanRequired?: boolean;
    manifest?: AnyArgs | null;
    transitionFails?: Set<string>; // orderIds whose transition throws
  } = {},
) {
  const ships = opts.shipments ?? [{ id: 's1', orderId: 'o1' }];
  const manifestFindUnique = jest.fn(async () =>
    opts.manifest === undefined
      ? {
          id: MAN,
          manifestNumber: 'MF-2026-05-000001',
          status: opts.manifestStatus ?? ManifestStatus.CONFIRMED,
          shipments: ships.map((s) => ({
            id: s.id,
            shipmentNumber: `SH-${s.id}`,
            handoverScannedAt: s.handoverScannedAt ?? null,
            orderShipments:
              s.orderId === null ? [] : [{ orderId: s.orderId, order: { sellerId: 'seller-1' } }],
          })),
        }
      : opts.manifest,
  );
  const manifestUpdate = jest.fn(async () => ({}));
  const shipmentUpdate = jest.fn(async () => ({}));
  const client = {
    manifest: { findUnique: manifestFindUnique, update: manifestUpdate },
    shipment: { update: shipmentUpdate },
    systemSetting: {
      findUnique: jest.fn(async () => ({ valueBoolean: opts.handoverScanRequired === true })),
    },
  };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };
  const transitionStatus = jest.fn(async (input: { orderId: string }) => {
    if (opts.transitionFails?.has(input.orderId)) {
      throw new Error('INVALID_TRANSITION');
    }
    return { status: OrderStatus.DISPATCHED };
  });
  const orderWrite = { transitionStatus };

  // R4: NORMAL-mode fixtures — no serialized units exist, so the unit
  // ledger is a no-op here. countForShipment returning 0 is what makes
  // the strict gate skip; parcel-grained advances move nothing.
  const unitLedger = {
    countForShipment: jest.fn(async () => 0),
    advanceUnitsForShipment: jest.fn(async () => 0),
    scanUnits: jest.fn(async () => []),
    scanUnitsForShipment: jest.fn(async () => 0),
  };
  const svc = new DispatchHandoffService(
    { client } as unknown as PrismaService,
    // Not on hold. A restricted seller is covered in
    // seller-restriction.service.spec.
    { assertAllowed: async () => undefined } as never,
    audit as unknown as AuditLogService,
    orderWrite as unknown as OrderWriteService,
    unitLedger as unknown as StockUnitService,
  );
  return { svc, client, manifestUpdate, shipmentUpdate, transitionStatus, auditLog };
}

describe('DispatchHandoffService.confirmHandoff', () => {
  it('transitions every AWB-ready shipment + flips the manifest DISPATCHED', async () => {
    const { svc, manifestUpdate, shipmentUpdate, transitionStatus } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1' },
        { id: 's2', orderId: 'o2' },
      ],
    });
    const r = await svc.confirmHandoff(MAN, STAFF);
    expect(r).toMatchObject({
      status: ManifestStatus.DISPATCHED,
      transitionedCount: 2,
      failures: [],
      alreadyDispatched: false,
    });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.DISPATCHED,
        expectedFrom: OrderStatus.PENDING_DISPATCH,
      }),
    );
    // Shipment → HANDED_TO_COURIER.
    expect(shipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ShipmentStatus.HANDED_TO_COURIER,
        }),
      }),
    );
    // Manifest update LAST — after the per-shipment transitions.
    const lastTransOrd = Math.max(...transitionStatus.mock.invocationCallOrder);
    expect(manifestUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(lastTransOrd);
    expect(manifestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ManifestStatus.DISPATCHED,
          handoffConfirmedByStaffId: STAFF,
        }),
      }),
    );
  });

  it('idempotent: an already-DISPATCHED manifest is a no-op', async () => {
    const { svc, manifestUpdate, transitionStatus } = makeService({
      manifestStatus: ManifestStatus.DISPATCHED,
    });
    const r = await svc.confirmHandoff(MAN, STAFF);
    expect(r.alreadyDispatched).toBe(true);
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(manifestUpdate).not.toHaveBeenCalled();
  });

  it('rejects MANIFEST_NOT_DISPATCHABLE when the manifest is not CONFIRMED', async () => {
    const { svc } = makeService({ manifestStatus: ManifestStatus.CLOSED });
    await expect(svc.confirmHandoff(MAN, STAFF)).rejects.toMatchObject({
      response: { code: 'MANIFEST_NOT_DISPATCHABLE' },
    });
  });

  it('per-shipment failure isolation: one transition fails, others still dispatch', async () => {
    const { svc, transitionStatus } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1' },
        { id: 's2', orderId: 'o2' },
        { id: 's3', orderId: 'o3' },
      ],
      transitionFails: new Set(['o2']),
    });
    const r = await svc.confirmHandoff(MAN, STAFF);
    expect(transitionStatus).toHaveBeenCalledTimes(3); // all attempted
    expect(r.transitionedCount).toBe(2);
    expect(r.failures).toEqual([{ shipmentId: 's2', orderId: 'o2', error: 'INVALID_TRANSITION' }]);
    // Manifest still flips DISPATCHED (handoff physically happened;
    // failures surfaced for ops).
    expect(r.status).toBe(ManifestStatus.DISPATCHED);
  });

  it('records ORDER_SHIPMENT_MISSING as a failure (no orderId)', async () => {
    const { svc } = makeService({
      shipments: [{ id: 's1', orderId: null }],
    });
    const r = await svc.confirmHandoff(MAN, STAFF);
    expect(r.failures).toEqual([
      { shipmentId: 's1', orderId: null, error: 'ORDER_SHIPMENT_MISSING' },
    ]);
  });

  it('404 when the manifest is missing', async () => {
    const { svc } = makeService({ manifest: null });
    await expect(svc.confirmHandoff(MAN, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('audits HIGH when there are failures, MEDIUM when clean', async () => {
    const clean = makeService();
    await clean.svc.confirmHandoff(MAN, STAFF);
    expect(clean.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manifest.dispatched', severity: 'MEDIUM' }),
    );
    const withFail = makeService({
      shipments: [{ id: 's1', orderId: 'o1' }],
      transitionFails: new Set(['o1']),
    });
    await withFail.svc.confirmHandoff(MAN, STAFF);
    expect(withFail.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'manifest.dispatched', severity: 'HIGH' }),
    );
  });
});

// ---------------------------------------------------------------------
// The handover scan gate (`ops.handover_scan_required`).
//
// Enforced in the SERVICE rather than by hiding a button, which is the
// whole point of it: when the setting is on, nothing reaches a driver
// unscanned, and a check that lives in the UI is one `curl` away from
// not existing.
// ---------------------------------------------------------------------
describe('DispatchHandoffService — the handover scan gate', () => {
  it('is OFF by default, and hands over without any scan', async () => {
    // A step nobody chose is a step that gets worked around.
    const { svc, transitionStatus } = makeService({
      shipments: [{ id: 's1', orderId: 'o1', handoverScannedAt: null }],
    });
    await svc.confirmHandoff(MAN, 'staff-1');
    expect(transitionStatus).toHaveBeenCalled();
  });

  it('REFUSES the whole handover when a parcel was not scanned', async () => {
    const { svc, transitionStatus } = makeService({
      handoverScanRequired: true,
      shipments: [{ id: 's1', orderId: 'o1', handoverScannedAt: null }],
    });
    await expect(svc.confirmHandoff(MAN, 'staff-1')).rejects.toMatchObject({
      response: { code: 'HANDOVER_SCAN_REQUIRED' },
    });
    // Nothing moved. A partial handover would be worse than a refused
    // one: some parcels gone, the rest sitting, and no record of which.
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('NAMES the parcels that were missed', async () => {
    // "Some of these were not scanned" sends somebody to check all forty.
    const { svc } = makeService({
      handoverScanRequired: true,
      shipments: [
        { id: 's1', orderId: 'o1', handoverScannedAt: new Date() },
        { id: 's2', orderId: 'o2', handoverScannedAt: null },
      ],
    });
    await expect(svc.confirmHandoff(MAN, 'staff-1')).rejects.toMatchObject({
      response: { message: expect.stringContaining('SH-s2') },
    });
  });

  it('lets a fully scanned manifest through', async () => {
    const { svc, transitionStatus } = makeService({
      handoverScanRequired: true,
      shipments: [
        { id: 's1', orderId: 'o1', handoverScannedAt: new Date() },
        { id: 's2', orderId: 'o2', handoverScannedAt: new Date() },
      ],
    });
    await svc.confirmHandoff(MAN, 'staff-1');
    expect(transitionStatus).toHaveBeenCalledTimes(2);
  });

  it('an unreadable setting does not strand the warehouse', async () => {
    // Fail-open on purpose: a bench that cannot hand over parcels
    // because a settings row would not load is a worse outage than a
    // missed scan.
    const { svc, client, transitionStatus } = makeService({
      shipments: [{ id: 's1', orderId: 'o1', handoverScannedAt: null }],
    });
    (client.systemSetting.findUnique as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await svc.confirmHandoff(MAN, 'staff-1');
    expect(transitionStatus).toHaveBeenCalled();
  });
});
