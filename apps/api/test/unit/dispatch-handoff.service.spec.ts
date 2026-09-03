import { ConflictException, NotFoundException } from '@nestjs/common';
import { ManifestStatus, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { DispatchHandoffService } from '../../src/modules/courier-dispatch/services/dispatch-handoff.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';
import type { ScanBlockService } from '../../src/modules/system-issues/services/scan-block.service';

type AnyArgs = Record<string, unknown>;
const MAN = 'man-1';
const STAFF = 'sup-1';

function makeService(
  opts: {
    manifestStatus?: ManifestStatus;
    shipments?: Array<{ id: string; orderId: string | null; handoverScannedAt?: Date | null }>;
    handoverScanRequired?: boolean;
    /** ops.handover_scan_dispatches — ON in production, so ON here too
     *  unless a test is deliberately exercising the legacy path. */
    handoverScanDispatches?: boolean;
    manifest?: AnyArgs | null;
    transitionFails?: Set<string>; // orderIds whose transition throws
    /** The row recordHandoverScan finds by AWB. `null` ⇒ nothing found. */
    scannedShipment?: AnyArgs | null;
    /** What flipManifestIfComplete sees on the manifest afterwards. */
    manifestShipments?: Array<{ id: string; status: ShipmentStatus }>;
    /** This operator is already stopped by an unresolved duplicate. */
    blockedStaff?: boolean;
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
  const manifestUpdateMany = jest.fn(async () => ({ count: 1 }));
  const shipmentUpdate = jest.fn(async () => ({}));
  const shipmentUpdateMany = jest.fn(async () => ({ count: 1 }));
  const shipmentFindFirst = jest.fn(async () =>
    opts.scannedShipment === undefined
      ? {
          id: 's1',
          shipmentNumber: 'SH-s1',
          handoverScannedAt: null,
          status: ShipmentStatus.CREATED,
          manifestId: MAN,
          orderShipments: [
            { orderId: 'o1', order: { status: OrderStatus.PACKED, sellerId: 'seller-1' } },
          ],
        }
      : opts.scannedShipment,
  );
  const shipmentFindMany = jest.fn(
    async () => opts.manifestShipments ?? [{ id: 's1', status: ShipmentStatus.HANDED_TO_COURIER }],
  );
  // Key-AWARE: the two handover settings are different questions and a
  // mock that answers both with one boolean cannot tell them apart.
  const settingFindUnique = jest.fn(async (args: AnyArgs) => {
    const key = (args['where'] as AnyArgs)['key'];
    if (key === 'ops.handover_scan_dispatches') {
      return { valueBoolean: opts.handoverScanDispatches !== false };
    }
    return { valueBoolean: opts.handoverScanRequired === true };
  });
  const client = {
    manifest: {
      findUnique: manifestFindUnique,
      update: manifestUpdate,
      updateMany: manifestUpdateMany,
    },
    shipment: {
      update: shipmentUpdate,
      updateMany: shipmentUpdateMany,
      findFirst: shipmentFindFirst,
      findMany: shipmentFindMany,
    },
    systemSetting: { findUnique: settingFindUnique },
    // Re-read after a lost transition race — see the convergence test.
    order: {
      findUnique: jest.fn<Promise<{ status: OrderStatus } | null>, []>(async () => ({
        status: OrderStatus.PACKED,
      })),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
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
  // The block is a hard stop, so the fake has to be able to BOTH allow
  // and refuse — a mock that only ever allows cannot see a regression
  // that stops blocking.
  const scanBlock = {
    assertNotBlocked: jest.fn(async () => {
      if (opts.blockedStaff === true) {
        throw new ConflictException({ code: 'SCAN_BLOCKED', message: 'stopped' });
      }
    }),
    refuseDuplicate: jest.fn(async () => {
      throw new ConflictException({ code: 'DUPLICATE_SCAN', message: 'already with the courier' });
    }),
    currentBlock: jest.fn(async () => null),
  };
  const svc = new DispatchHandoffService(
    { client } as unknown as PrismaService,
    // Not on hold. A restricted seller is covered in
    // seller-restriction.service.spec.
    { assertAllowed: async () => undefined } as never,
    audit as unknown as AuditLogService,
    orderWrite as unknown as OrderWriteService,
    unitLedger as unknown as StockUnitService,
    scanBlock as unknown as ScanBlockService,
  );
  return {
    svc,
    client,
    manifestUpdate,
    manifestUpdateMany,
    shipmentUpdate,
    shipmentUpdateMany,
    shipmentFindMany,
    transitionStatus,
    auditLog,
    unitLedger,
    scanBlock,
  };
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

describe('DispatchHandoffService.recordHandoverScan — the scan IS the handover', () => {
  it('dispatches the parcel: stamp FIRST, transition LAST', async () => {
    const { svc, shipmentUpdateMany, shipmentUpdate, transitionStatus } = makeService();
    const r = await svc.recordHandoverScan('DLV-123', STAFF);

    expect(r).toMatchObject({
      shipmentNumber: 'SH-s1',
      orderId: 'o1',
      alreadyScanned: false,
      dispatched: true,
    });
    // PACKED → DISPATCHED directly: no manifest had to be closed first.
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o1',
        to: OrderStatus.DISPATCHED,
        expectedFrom: OrderStatus.PACKED,
      }),
    );
    expect(shipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ShipmentStatus.HANDED_TO_COURIER }),
      }),
    );
    // Visible-vs-silent: the scan stamp is durable before the transition
    // runs, so a crash between leaves a scanned-but-undispatched parcel
    // rather than a dispatched one nobody scanned.
    expect(shipmentUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      transitionStatus.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('dispatches a parcel someone DID close a manifest for (PENDING_DISPATCH)', async () => {
    const { svc, transitionStatus } = makeService({
      scannedShipment: {
        id: 's1',
        shipmentNumber: 'SH-s1',
        handoverScannedAt: null,
        status: ShipmentStatus.CREATED,
        manifestId: MAN,
        orderShipments: [
          { orderId: 'o1', order: { status: OrderStatus.PENDING_DISPATCH, sellerId: 'seller-1' } },
        ],
      },
    });
    await svc.recordHandoverScan('DLV-123', STAFF);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ expectedFrom: OrderStatus.PENDING_DISPATCH }),
    );
  });

  it('closes the manifest out once its last parcel is scanned', async () => {
    const { svc, manifestUpdateMany } = makeService({
      manifestShipments: [
        { id: 's1', status: ShipmentStatus.HANDED_TO_COURIER },
        { id: 's2', status: ShipmentStatus.HANDED_TO_COURIER },
      ],
    });
    const r = await svc.recordHandoverScan('DLV-123', STAFF);
    expect(r.manifestDispatched).toBe(true);
    expect(manifestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ManifestStatus.DISPATCHED }),
      }),
    );
  });

  it('leaves the manifest open while a parcel on it has not gone', async () => {
    // The one that stayed behind IS the signal. Closing the manifest
    // around it would be the single record for "what went on the van"
    // saying something that did not happen.
    const { svc, manifestUpdateMany } = makeService({
      manifestShipments: [
        { id: 's1', status: ShipmentStatus.HANDED_TO_COURIER },
        { id: 's2', status: ShipmentStatus.CREATED },
      ],
    });
    const r = await svc.recordHandoverScan('DLV-123', STAFF);
    expect(r.manifestDispatched).toBe(false);
    expect(manifestUpdateMany).not.toHaveBeenCalled();
  });

  it('a REPEATED box stops the operator — it does not quietly succeed', async () => {
    // Reverses an earlier call to treat this as a harmless no-op. A
    // parcel that has already gone being scanned again means either two
    // boxes carry one label, or this pile was already loaded. Neither
    // is visible to anyone but the person holding it.
    const { svc, transitionStatus, scanBlock } = makeService({
      scannedShipment: {
        id: 's1',
        shipmentNumber: 'SH-s1',
        handoverScannedAt: new Date(),
        status: ShipmentStatus.HANDED_TO_COURIER,
        manifestId: MAN,
        orderShipments: [
          { orderId: 'o1', order: { status: OrderStatus.DISPATCHED, sellerId: 'seller-1' } },
        ],
      },
    });
    await expect(svc.recordHandoverScan('DLV-123', STAFF)).rejects.toMatchObject({
      response: { code: 'DUPLICATE_SCAN' },
    });
    expect(scanBlock.refuseDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ flow: 'HANDOVER', staffId: STAFF, shipmentId: 's1' }),
    );
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('an operator already stopped is refused BEFORE the parcel is even looked up', async () => {
    // The stop is about the pile, not only the box that caused it — so
    // the next parcel is refused too.
    const { svc, client, transitionStatus } = makeService({ blockedStaff: true });
    await expect(svc.recordHandoverScan('DLV-999', STAFF)).rejects.toMatchObject({
      response: { code: 'SCAN_BLOCKED' },
    });
    expect(client.shipment.findFirst).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('a scan gun firing twice is NOT a repeated box — it converges', async () => {
    // Both calls read the parcel before either stamps it, so both get
    // past the duplicate check and race at the transition. That is one
    // box read twice by a twitchy reader; stopping the operator for it
    // would have the bench blocked several times a day.
    const { svc, transitionStatus, client } = makeService();
    transitionStatus.mockRejectedValueOnce(new Error('STALE_ORDER_STATUS'));
    client.order.findUnique = jest.fn(async () => ({ status: OrderStatus.DISPATCHED }));
    const r = await svc.recordHandoverScan('DLV-123', STAFF);
    expect(r).toMatchObject({ alreadyScanned: true, dispatched: true });
  });

  it('a transition that failed for a REAL reason still throws', async () => {
    // The convergence above must not swallow a genuine failure: it only
    // applies when the order actually did reach DISPATCHED.
    const { svc, transitionStatus, client } = makeService();
    transitionStatus.mockRejectedValueOnce(new Error('SELLER_ON_HOLD'));
    client.order.findUnique = jest.fn(async () => ({ status: OrderStatus.PACKED }));
    await expect(svc.recordHandoverScan('DLV-123', STAFF)).rejects.toThrow('SELLER_ON_HOLD');
  });

  it('refuses a parcel that is not packed yet, and NAMES its status', async () => {
    const { svc, transitionStatus } = makeService({
      scannedShipment: {
        id: 's1',
        shipmentNumber: 'SH-s1',
        handoverScannedAt: null,
        status: ShipmentStatus.CREATED,
        manifestId: null,
        orderShipments: [
          { orderId: 'o1', order: { status: OrderStatus.PICKED, sellerId: 'seller-1' } },
        ],
      },
    });
    await expect(svc.recordHandoverScan('DLV-123', STAFF)).rejects.toMatchObject({
      response: { code: 'NOT_READY_FOR_HANDOVER', message: expect.stringContaining('PICKED') },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('404s an AWB nothing live carries', async () => {
    const { svc } = makeService({ scannedShipment: null });
    await expect(svc.recordHandoverScan('NOPE', STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('switch OFF: records the scan and dispatches NOTHING (the legacy path)', async () => {
    const { svc, shipmentUpdateMany, transitionStatus } = makeService({
      handoverScanDispatches: false,
    });
    const r = await svc.recordHandoverScan('DLV-123', STAFF);
    expect(r).toMatchObject({ alreadyScanned: false, dispatched: false });
    expect(shipmentUpdateMany).toHaveBeenCalled(); // still stamped
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('a unit-ledger failure never undoes a real handover', async () => {
    const { svc, unitLedger, transitionStatus } = makeService();
    unitLedger.advanceUnitsForShipment.mockRejectedValueOnce(new Error('ledger down'));
    const r = await svc.recordHandoverScan('DLV-123', STAFF);
    // The courier already has the box.
    expect(r.dispatched).toBe(true);
    expect(transitionStatus).toHaveBeenCalled();
  });
});
