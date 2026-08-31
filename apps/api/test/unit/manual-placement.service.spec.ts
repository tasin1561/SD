import { NotFoundException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import type { CourierFeeAccrualService } from '../../src/modules/seller-wallet-accrual/services/courier-fee-accrual.service';
import { ManualPlacementService } from '../../src/modules/courier-manual-placement/services/manual-placement.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';

type AnyArgs = Record<string, unknown>;
const SHIP = 's-1';
const ORDER = 'o-1';
const STAFF = 'mpa-1';

interface ResvLoc {
  id: string;
  orderItemId: string;
  qtyReserved: number;
  sellerId: string;
  variantId: string;
  warehouseId: string;
  binId: string | null;
  batchId: string | null;
}

function phase2(id: string): ResvLoc {
  return {
    id,
    orderItemId: `oi-${id}`,
    qtyReserved: 2,
    sellerId: 'seller-1',
    variantId: 'v-1',
    warehouseId: 'w-1',
    binId: 'bin-1',
    batchId: 'batch-1',
  };
}
function phase1(id: string): ResvLoc {
  return { ...phase2(id), binId: null, batchId: null };
}

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    shipmentStatus?: ShipmentStatus;
    awbNumber?: string | null;
    isManualCourier?: boolean;
    orderStatus?: OrderStatus;
    reservations?: ResvLoc[];
    awbClash?: boolean;
    transitionTo?: OrderStatus;
  } = {},
) {
  const shipmentRow =
    opts.shipment === undefined
      ? {
          id: SHIP,
          status: opts.shipmentStatus ?? ShipmentStatus.CREATED,
          awbNumber: opts.awbNumber ?? null,
          isManualCourier: opts.isManualCourier ?? false,
          orderShipments: [
            {
              order: {
                id: ORDER,
                status: opts.orderStatus ?? OrderStatus.PENDING_MANUAL_PLACEMENT,
                sellerId: 'seller-1',
              },
            },
          ],
        }
      : opts.shipment;

  const shipmentFindUnique = jest.fn(async () => shipmentRow);
  const shipmentFindFirst = jest.fn(async () => (opts.awbClash ? { id: 'other-ship' } : null));
  const shipmentUpdate = jest.fn(async () => ({}));
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a');
  const txClient = {
    shipment: { update: shipmentUpdate },
  };
  const $transaction = jest.fn(async (fn: (tx: typeof txClient) => unknown) => fn(txClient));
  const client = {
    shipment: {
      findUnique: shipmentFindUnique,
      findFirst: shipmentFindFirst,
      update: shipmentUpdate,
    },
    $transaction,
  };
  const transitionStatus = jest.fn(async () => ({
    orderId: ORDER,
    fromStatus: OrderStatus.PENDING_MANUAL_PLACEMENT,
    status: opts.transitionTo ?? OrderStatus.DISPATCHED,
    reservationOutcome: 'FULFILLED' as const,
  }));
  const listActiveForOrderWithLocations = jest.fn(async () => opts.reservations ?? [phase2('r1')]);

  const svc = new ManualPlacementService(
    { client } as unknown as PrismaService,
    { log: auditLog } as unknown as AuditLogService,
    { transitionStatus } as unknown as OrderWriteService,
    {
      listActiveForOrderWithLocations,
    } as unknown as StockReservationService,
    // Charging at courier entry is exercised in the accrual suite and
    // end to end; here it must not be able to fail the placement.
    { tryEarlyAccrual: jest.fn(async () => undefined) } as unknown as CourierFeeAccrualService,
  );
  return {
    svc,
    shipmentUpdate,
    auditLog,
    transitionStatus,
    listActiveForOrderWithLocations,
  };
}

describe('ManualPlacementService.placeAwb', () => {
  it('stamps the manual AWB, dispatches the order, marks HANDED_TO_COURIER', async () => {
    const { svc, shipmentUpdate, transitionStatus } = makeService();
    const r = await svc.placeAwb(SHIP, { awbNumber: 'BD-001', courierName: 'Bluedart' }, STAFF);
    expect(r).toMatchObject({
      shipmentId: SHIP,
      orderId: ORDER,
      awbNumber: 'BD-001',
      orderStatus: OrderStatus.DISPATCHED,
      shipmentStatus: ShipmentStatus.HANDED_TO_COURIER,
      alreadyPlaced: false,
    });
    // AWB stamp (status AWB_GENERATED) FIRST, transition LAST.
    const calls = shipmentUpdate.mock.calls as unknown as Array<[{ data: AnyArgs }]>;
    const stampCall = calls.find((c) => c[0].data.status === ShipmentStatus.AWB_GENERATED);
    expect(stampCall).toBeDefined();
    expect(stampCall![0].data).toMatchObject({
      awbNumber: 'BD-001',
      courierCode: 'manual',
      isManualCourier: true,
      // The carrier is its own column now. This used to assert
      // `serviceType: 'Bluedart'` — the bug, written down as an
      // expectation.
      manualCourierName: 'Bluedart',
      serviceType: null,
    });
    const stampOrder = shipmentUpdate.mock.invocationCallOrder[0]!;
    const transOrder = transitionStatus.mock.invocationCallOrder[0]!;
    expect(stampOrder).toBeLessThan(transOrder);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.DISPATCHED,
        expectedFrom: OrderStatus.PENDING_MANUAL_PLACEMENT,
      }),
    );
  });

  it('idempotent: AWB already stamped + order DISPATCHED → alreadyPlaced, no transition', async () => {
    const { svc, transitionStatus } = makeService({
      awbNumber: 'BD-OLD',
      isManualCourier: true,
      shipmentStatus: ShipmentStatus.HANDED_TO_COURIER,
      orderStatus: OrderStatus.DISPATCHED,
    });
    const r = await svc.placeAwb(SHIP, { awbNumber: 'BD-OLD', courierName: 'Bluedart' }, STAFF);
    expect(r.alreadyPlaced).toBe(true);
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('convergent recovery: AWB stamped but order still PENDING_MANUAL_PLACEMENT → re-runs the transition', async () => {
    const { svc, transitionStatus, shipmentUpdate } = makeService({
      awbNumber: 'BD-STAMPED',
      isManualCourier: true,
      shipmentStatus: ShipmentStatus.AWB_GENERATED,
      orderStatus: OrderStatus.PENDING_MANUAL_PLACEMENT,
    });
    const r = await svc.placeAwb(SHIP, { awbNumber: 'BD-STAMPED', courierName: 'Bluedart' }, STAFF);
    expect(r.alreadyPlaced).toBe(false);
    expect(transitionStatus).toHaveBeenCalledTimes(1);
    // No re-stamp — the AWB tx is skipped, only the HANDED_TO_COURIER
    // update runs.
    expect(shipmentUpdate).toHaveBeenCalledTimes(1);
    expect(shipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ShipmentStatus.HANDED_TO_COURIER,
        }),
      }),
    );
  });

  it('conservation guard: a phase-1 residual reservation → MANUAL_PLACEMENT_NOT_ALLOCATED', async () => {
    const { svc, transitionStatus } = makeService({
      reservations: [phase2('r1'), phase1('r2')],
    });
    await expect(
      svc.placeAwb(SHIP, { awbNumber: 'BD-002', courierName: 'Bluedart' }, STAFF),
    ).rejects.toMatchObject({
      response: { code: 'MANUAL_PLACEMENT_NOT_ALLOCATED' },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('conservation guard: no active reservations → MANUAL_PLACEMENT_NO_RESERVATIONS', async () => {
    const { svc } = makeService({ reservations: [] });
    await expect(
      svc.placeAwb(SHIP, { awbNumber: 'BD-003', courierName: 'Bluedart' }, STAFF),
    ).rejects.toMatchObject({
      response: { code: 'MANUAL_PLACEMENT_NO_RESERVATIONS' },
    });
  });

  it('rejects ORDER_NOT_MANUAL_PLACEMENT when the order is not PENDING_MANUAL_PLACEMENT', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.CONFIRMED });
    await expect(
      svc.placeAwb(SHIP, { awbNumber: 'BD-004', courierName: 'Bluedart' }, STAFF),
    ).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_MANUAL_PLACEMENT' },
    });
  });

  it('rejects SHIPMENT_NOT_MANUAL_ELIGIBLE when the shipment is not CREATED', async () => {
    const { svc } = makeService({
      shipmentStatus: ShipmentStatus.FAILED_AT_CREATION,
    });
    await expect(
      svc.placeAwb(SHIP, { awbNumber: 'BD-005', courierName: 'Bluedart' }, STAFF),
    ).rejects.toMatchObject({
      response: { code: 'SHIPMENT_NOT_MANUAL_ELIGIBLE' },
    });
  });

  it('rejects AWB_ALREADY_IN_USE when the AWB clashes with another shipment', async () => {
    const { svc } = makeService({ awbClash: true });
    await expect(
      svc.placeAwb(SHIP, { awbNumber: 'DUP-AWB', courierName: 'Bluedart' }, STAFF),
    ).rejects.toMatchObject({
      response: { code: 'AWB_ALREADY_IN_USE' },
    });
  });

  it('rejects SHIPMENT_ALREADY_HAS_AWB when the shipment carries a non-manual (Delhivery) AWB', async () => {
    const { svc } = makeService({
      awbNumber: 'DLVSTUB123',
      isManualCourier: false,
    });
    await expect(
      svc.placeAwb(SHIP, { awbNumber: 'BD-006', courierName: 'Bluedart' }, STAFF),
    ).rejects.toMatchObject({
      response: { code: 'SHIPMENT_ALREADY_HAS_AWB' },
    });
  });

  it('404 when the shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(
      svc.placeAwb(SHIP, { awbNumber: 'BD-007', courierName: 'Bluedart' }, STAFF),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ManualPlacementService.cancelUnfulfillable', () => {
  it('transitions PENDING_MANUAL_PLACEMENT → CANCELLED_BY_ADMIN', async () => {
    const { svc, transitionStatus } = makeService({
      transitionTo: OrderStatus.CANCELLED_BY_ADMIN,
    });
    const r = await svc.cancelUnfulfillable(SHIP, 'No courier serves this pincode', STAFF);
    expect(r).toMatchObject({
      orderId: ORDER,
      orderStatus: OrderStatus.CANCELLED_BY_ADMIN,
      alreadyCancelled: false,
    });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.CANCELLED_BY_ADMIN,
        expectedFrom: OrderStatus.PENDING_MANUAL_PLACEMENT,
      }),
    );
  });

  it('idempotent: an already-cancelled order → alreadyCancelled, no transition', async () => {
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.CANCELLED_BY_ADMIN,
    });
    const r = await svc.cancelUnfulfillable(SHIP, 'too late', STAFF);
    expect(r.alreadyCancelled).toBe(true);
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('rejects ORDER_NOT_MANUAL_PLACEMENT when the order is elsewhere in the lifecycle', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.DISPATCHED });
    await expect(svc.cancelUnfulfillable(SHIP, 'wrong state', STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_MANUAL_PLACEMENT' },
    });
  });
});

describe('ManualPlacementService — the carrier name is its own fact', () => {
  it('writes the carrier to manualCourierName and leaves serviceType alone', async () => {
    const { svc, shipmentUpdate } = makeService();
    await svc.placeAwb(
      SHIP,
      { awbNumber: 'BD-NAME-1', courierName: '  Bluedart  ', serviceType: 'Surface' },
      STAFF,
    );
    const stamp = (shipmentUpdate.mock.calls as unknown as Array<[{ data: AnyArgs }]>)[0]?.[0].data;
    // Trimmed, and in its OWN column.
    expect(stamp).toMatchObject({ manualCourierName: 'Bluedart', serviceType: 'Surface' });
  });

  it('REGRESSION: a supplied service type no longer swallows the carrier', async () => {
    // The bug: `serviceType: input.serviceType ?? input.courierName` meant
    // an operator who filled BOTH fields lost the carrier entirely, and
    // nothing reported it — the seller was simply told "manual" forever.
    const { svc, shipmentUpdate } = makeService();
    await svc.placeAwb(
      SHIP,
      { awbNumber: 'BD-NAME-2', courierName: 'Sundarban', serviceType: 'Express' },
      STAFF,
    );
    const stamp = (shipmentUpdate.mock.calls as unknown as Array<[{ data: AnyArgs }]>)[0]?.[0].data;
    expect(stamp).toMatchObject({ manualCourierName: 'Sundarban' });
    expect(stamp).not.toMatchObject({ serviceType: 'Sundarban' });
  });

  it('records the carrier on the audit row too', async () => {
    const { svc, auditLog } = makeService();
    await svc.placeAwb(SHIP, { awbNumber: 'BD-NAME-3', courierName: 'DTDC' }, STAFF);
    const entry = (auditLog.mock.calls as unknown as Array<[{ metadata: AnyArgs }]>)[0]?.[0];
    expect(entry?.metadata).toMatchObject({ courierName: 'DTDC' });
  });

  it('leaves serviceType null when only the carrier is given', async () => {
    const { svc, shipmentUpdate } = makeService();
    await svc.placeAwb(SHIP, { awbNumber: 'BD-NAME-4', courierName: 'Bluedart' }, STAFF);
    const stamp = (shipmentUpdate.mock.calls as unknown as Array<[{ data: AnyArgs }]>)[0]?.[0].data;
    expect(stamp).toMatchObject({ manualCourierName: 'Bluedart', serviceType: null });
  });
});
