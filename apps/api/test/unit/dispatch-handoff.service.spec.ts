import { NotFoundException } from '@nestjs/common';
import { ManifestStatus, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { DispatchHandoffService } from '../../src/modules/courier-dispatch/services/dispatch-handoff.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';

type AnyArgs = Record<string, unknown>;
const MAN = 'man-1';
const STAFF = 'sup-1';

function makeService(
  opts: {
    manifestStatus?: ManifestStatus;
    shipments?: Array<{ id: string; orderId: string | null }>;
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
            orderShipments:
              s.orderId === null ? [] : [{ orderId: s.orderId }],
          })),
        }
      : opts.manifest,
  );
  const manifestUpdate = jest.fn(async () => ({}));
  const shipmentUpdate = jest.fn(async () => ({}));
  const client = {
    manifest: { findUnique: manifestFindUnique, update: manifestUpdate },
    shipment: { update: shipmentUpdate },
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

  const svc = new DispatchHandoffService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    orderWrite as unknown as OrderWriteService,
  );
  return { svc, manifestUpdate, shipmentUpdate, transitionStatus, auditLog };
}

describe('DispatchHandoffService.confirmHandoff', () => {
  it('transitions every AWB-ready shipment + flips the manifest DISPATCHED', async () => {
    const { svc, manifestUpdate, shipmentUpdate, transitionStatus } =
      makeService({
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
    const lastTransOrd = Math.max(
      ...transitionStatus.mock.invocationCallOrder,
    );
    expect(manifestUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(
      lastTransOrd,
    );
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
    expect(r.failures).toEqual([
      { shipmentId: 's2', orderId: 'o2', error: 'INVALID_TRANSITION' },
    ]);
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
    await expect(svc.confirmHandoff(MAN, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
