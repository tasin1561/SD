import { NotFoundException } from '@nestjs/common';
import { ManifestStatus, OrderStatus, SupersedeReason } from '@skydrop/db';
import { AwbGenerationJobService } from '../../src/modules/courier-awb/services/awb-generation-job.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { AwbGenerationService } from '../../src/modules/courier-awb/services/awb-generation.service';
import type { AwbSupersedeService } from '../../src/modules/courier-awb/services/awb-supersede.service';
import type { CourierFeeAccrualService } from '../../src/modules/seller-wallet-accrual/services/courier-fee-accrual.service';

type AnyArgs = Record<string, unknown>;
const MAN = 'man-1';

/** Per-shipment generation outcome the test wants generateForShipment
 *  to produce (or 'throw' for an unexpected exception). */
type GenPlan =
  | { kind: 'ok' }
  | { kind: 'label_pending' }
  | { kind: 'fail'; serviceable: boolean; errorCode?: string }
  | { kind: 'throw' };

function makeService(
  opts: {
    manifestStatus?: ManifestStatus;
    /** shipment id → gen plan. Order = manifest.shipments order. */
    shipments?: Array<{ id: string; orderId: string; plan: GenPlan }>;
    manifest?: AnyArgs | null;
    transitionThrows?: 'STALE' | 'OTHER';
  } = {},
) {
  const ships = opts.shipments ?? [{ id: 's1', orderId: 'o1', plan: { kind: 'ok' } }];
  const manifestFindUnique = jest.fn(async () =>
    opts.manifest === undefined
      ? {
          id: MAN,
          status: opts.manifestStatus ?? ManifestStatus.CLOSED,
          shipments: ships.map((s) => ({
            id: s.id,
            orderShipments: [{ orderId: s.orderId }],
          })),
        }
      : opts.manifest,
  );
  const manifestUpdate = jest.fn(async () => ({}));
  const client = {
    manifest: { findUnique: manifestFindUnique, update: manifestUpdate },
  };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  const transitionStatus = jest.fn(async () => {
    if (opts.transitionThrows === 'STALE') {
      throw { response: { code: 'STALE_ORDER_STATUS' } };
    }
    if (opts.transitionThrows === 'OTHER') {
      throw { response: { code: 'INVALID_TRANSITION' } };
    }
    return { status: OrderStatus.PENDING_MANUAL_PLACEMENT };
  });
  const orderWrite = { transitionStatus };

  const planById = new Map(ships.map((s) => [s.id, s.plan]));
  const generateForShipment = jest.fn(async (shipmentId: string) => {
    const plan = planById.get(shipmentId) ?? { kind: 'ok' };
    if (plan.kind === 'throw') throw new Error('boom');
    if (plan.kind === 'fail') {
      return {
        status: 'FAILED' as const,
        shipmentId,
        serviceable: plan.serviceable,
        errorCode: plan.errorCode ?? 'X',
        errorMessage: 'fail',
      };
    }
    if (plan.kind === 'label_pending') {
      // M10 commit 1: AWB durably persisted, label leg pending retry.
      return {
        status: 'GENERATED_AWB_LABEL_PENDING' as const,
        shipmentId,
        awbNumber: `AWB-${shipmentId}`,
        courierShipmentId: `CS-${shipmentId}`,
        errorMessage: 'SpacesUnavailable',
      };
    }
    return {
      status: 'GENERATED' as const,
      shipmentId,
      awbNumber: `AWB-${shipmentId}`,
      courierShipmentId: `CS-${shipmentId}`,
      labelSpacesKey: `k/${shipmentId}`,
      labelVersion: 1,
    };
  });
  const generation = { generateForShipment };

  const supersede = jest.fn(async (shipmentId: string) => ({
    oldShipmentId: shipmentId,
    newShipmentId: `new-${shipmentId}`,
    newShipmentNumber: 'SH-NEW',
    orderId: 'o',
    alreadySuperseded: false,
  }));
  const supersedeSvc = { supersede };

  const tryEarlyAccrual = jest.fn(async () => undefined);
  const courierFeeAccrual = { tryEarlyAccrual };

  const svc = new AwbGenerationJobService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    orderWrite as unknown as OrderWriteService,
    generation as unknown as AwbGenerationService,
    supersedeSvc as unknown as AwbSupersedeService,
    courierFeeAccrual as unknown as CourierFeeAccrualService,
  );
  return {
    svc,
    manifestUpdate,
    auditLog,
    transitionStatus,
    generateForShipment,
    supersede,
    tryEarlyAccrual,
  };
}

describe('AwbGenerationJobService.processManifest', () => {
  it('all shipments GENERATED → manifest CONFIRMED', async () => {
    const { svc, manifestUpdate } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1', plan: { kind: 'ok' } },
        { id: 's2', orderId: 'o2', plan: { kind: 'ok' } },
      ],
    });
    const r = await svc.processManifest(MAN);
    expect(r).toMatchObject({
      manifestStatus: ManifestStatus.CONFIRMED,
      generatedCount: 2,
      failedCount: 0,
      alreadyProcessed: false,
    });
    expect(manifestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ManifestStatus.CONFIRMED,
          awbJobCompletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("R1c: calls tryEarlyAccrual for each GENERATED shipment's order", async () => {
    const { svc, tryEarlyAccrual } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1', plan: { kind: 'ok' } },
        { id: 's2', orderId: 'o2', plan: { kind: 'ok' } },
      ],
    });
    await svc.processManifest(MAN);
    expect(tryEarlyAccrual).toHaveBeenCalledTimes(2);
    expect(tryEarlyAccrual).toHaveBeenCalledWith('o1');
    expect(tryEarlyAccrual).toHaveBeenCalledWith('o2');
  });

  it('R1c: also calls tryEarlyAccrual for a GENERATED_AWB_LABEL_PENDING shipment (AWB is durably persisted)', async () => {
    const { svc, tryEarlyAccrual } = makeService({
      shipments: [{ id: 's1', orderId: 'o1', plan: { kind: 'label_pending' } }],
    });
    await expect(svc.processManifest(MAN)).rejects.toThrow();
    expect(tryEarlyAccrual).toHaveBeenCalledWith('o1');
  });

  it('R1c: does NOT call tryEarlyAccrual for a FAILED (superseded) shipment', async () => {
    const { svc, tryEarlyAccrual } = makeService({
      shipments: [{ id: 's1', orderId: 'o1', plan: { kind: 'fail', serviceable: false } }],
    });
    await svc.processManifest(MAN);
    expect(tryEarlyAccrual).not.toHaveBeenCalled();
  });

  it('per-shipment failure isolation: 1 of 3 fails → 2 GENERATED + 1 SUPERSEDED, manifest CONFIRMED', async () => {
    const { svc, transitionStatus, supersede } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1', plan: { kind: 'ok' } },
        { id: 's2', orderId: 'o2', plan: { kind: 'fail', serviceable: false } },
        { id: 's3', orderId: 'o3', plan: { kind: 'ok' } },
      ],
    });
    const r = await svc.processManifest(MAN);
    expect(r.manifestStatus).toBe(ManifestStatus.CONFIRMED);
    expect(r.generatedCount).toBe(2);
    expect(r.failedCount).toBe(1);
    // The failed shipment's order was routed to PENDING_MANUAL_PLACEMENT.
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o2',
        to: OrderStatus.PENDING_MANUAL_PLACEMENT,
        expectedFrom: OrderStatus.PENDING_DISPATCH,
      }),
    );
    // ... and superseded as AWB_REJECTED: the courier refused, but not
    // over the destination. `serviceable: false` no longer means "wrong
    // pincode" (CUR-13), so filing every refusal as NON_SERVICEABLE
    // would send the reader to check an address that was never the
    // problem.
    expect(supersede).toHaveBeenCalledWith('s2', SupersedeReason.AWB_REJECTED, expect.anything());
    const failed = r.outcomes.find((o) => o.shipmentId === 's2');
    expect(failed?.result).toBe('SUPERSEDED');
  });

  it('a refusal that IS about the pincode still supersedes as NON_SERVICEABLE', async () => {
    const { svc, supersede } = makeService({
      shipments: [
        {
          id: 's1',
          orderId: 'o1',
          plan: { kind: 'fail', serviceable: false, errorCode: 'DELHIVERY_NON_SERVICEABLE' },
        },
      ],
    });
    await svc.processManifest(MAN);
    expect(supersede).toHaveBeenCalledWith(
      's1',
      SupersedeReason.NON_SERVICEABLE,
      expect.anything(),
    );
  });

  it('serviceable:true failure → COURIER_FAILURE supersede reason', async () => {
    const { svc, supersede } = makeService({
      shipments: [{ id: 's1', orderId: 'o1', plan: { kind: 'fail', serviceable: true } }],
    });
    await svc.processManifest(MAN);
    expect(supersede).toHaveBeenCalledWith(
      's1',
      SupersedeReason.COURIER_FAILURE,
      expect.anything(),
    );
  });

  it('all shipments failed → manifest FAILED', async () => {
    const { svc } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1', plan: { kind: 'fail', serviceable: false } },
        { id: 's2', orderId: 'o2', plan: { kind: 'fail', serviceable: true } },
      ],
    });
    const r = await svc.processManifest(MAN);
    expect(r.manifestStatus).toBe(ManifestStatus.FAILED);
    expect(r.generatedCount).toBe(0);
    expect(r.failedCount).toBe(2);
  });

  it('per-shipment EXCEPTION isolation: a thrown error does not abort the others', async () => {
    const { svc, generateForShipment } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1', plan: { kind: 'ok' } },
        { id: 's2', orderId: 'o2', plan: { kind: 'throw' } },
        { id: 's3', orderId: 'o3', plan: { kind: 'ok' } },
      ],
    });
    const r = await svc.processManifest(MAN);
    expect(generateForShipment).toHaveBeenCalledTimes(3); // all attempted
    expect(r.generatedCount).toBe(2);
    expect(r.failedCount).toBe(1);
    expect(r.manifestStatus).toBe(ManifestStatus.CONFIRMED);
    expect(r.outcomes.find((o) => o.shipmentId === 's2')?.result).toBe('ERROR');
  });

  it('routeOrderToManual: a STALE transition (mid-retry already-moved) is swallowed', async () => {
    const { svc, supersede } = makeService({
      shipments: [{ id: 's1', orderId: 'o1', plan: { kind: 'fail', serviceable: false } }],
      transitionThrows: 'STALE',
    });
    const r = await svc.processManifest(MAN); // does not throw
    expect(r.failedCount).toBe(1);
    expect(supersede).toHaveBeenCalled(); // proceeds to supersede
  });

  it('idempotent: an already-CONFIRMED manifest is a no-op', async () => {
    const { svc, manifestUpdate, generateForShipment } = makeService({
      manifestStatus: ManifestStatus.CONFIRMED,
    });
    const r = await svc.processManifest(MAN);
    expect(r).toMatchObject({
      manifestStatus: ManifestStatus.CONFIRMED,
      alreadyProcessed: true,
      generatedCount: 0,
    });
    expect(generateForShipment).not.toHaveBeenCalled();
    expect(manifestUpdate).not.toHaveBeenCalled();
  });

  it('404 when the manifest is missing', async () => {
    const { svc } = makeService({ manifest: null });
    await expect(svc.processManifest(MAN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('M10 commit 1 — label-pending outcome blocks the manifest flip and THROWS so BullMQ retries', async () => {
    const { svc, manifestUpdate, auditLog } = makeService({
      shipments: [
        { id: 's1', orderId: 'o1', plan: { kind: 'ok' } },
        { id: 's2', orderId: 'o2', plan: { kind: 'label_pending' } },
      ],
    });
    // Throws so BullMQ's retry policy fires the whole job again; the
    // CUR-9 recovery path re-runs only the label leg next time.
    await expect(svc.processManifest(MAN)).rejects.toThrow(
      /AWB label upload pending for 1 shipment/,
    );
    // Manifest status NOT flipped — stays CLOSED until every label persists.
    expect(manifestUpdate).not.toHaveBeenCalled();
    // The HIGH-severity pending audit is the visible breadcrumb.
    const pendingAudit = auditLog.mock.calls.find(
      ([entry]) => (entry as { action?: string }).action === 'manifest.awb_job_label_pending',
    );
    expect(pendingAudit).toBeDefined();
    expect(pendingAudit?.[0]).toMatchObject({
      severity: 'HIGH',
      metadata: expect.objectContaining({
        labelPendingCount: 1,
        generatedCount: 2, // s1 fully done + s2 AWB durable = 2
        failedCount: 0,
      }),
    });
    // The successful audit is NOT written (we threw before it).
    const completedAudit = auditLog.mock.calls.find(
      ([entry]) => (entry as { action?: string }).action === 'manifest.awb_job_completed',
    );
    expect(completedAudit).toBeUndefined();
  });
});
