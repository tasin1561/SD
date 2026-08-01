import { NotFoundException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus, WarehouseStatus } from '@skydrop/db';
import type { RtoFeeAccrualService } from '../../src/modules/seller-wallet-accrual/services/rto-fee-accrual.service';
import { RtoReceiptService } from '../../src/modules/warehouse-rto/services/rto-receipt.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';

type AnyArgs = Record<string, unknown>;

const AWB = 'AWB-9999';
const SHIP = 'ship-1';
const ORDER = 'order-1';
const STAFF = 'staff-1';
const ORIGIN_WH = 'wh-origin';
const OTHER_WH = 'wh-other';

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    orderStatus?: OrderStatus | 'missing';
    stampCount?: number;
    /** R6 — warehouse row returned for a supplied receivedWarehouseId. */
    warehouse?: AnyArgs | null;
  } = {},
) {
  const defaultShipment = {
    id: SHIP,
    awbNumber: AWB,
    status: ShipmentStatus.RTO_IN_TRANSIT,
    rtoReceivedAt: null,
    originWarehouseId: ORIGIN_WH,
    rtoReceivedWarehouseId: null,
    orderShipments: [{ orderId: ORDER }],
  };
  const shipmentFindFirst = jest.fn(async () =>
    opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.stampCount ?? 1,
  }));
  const warehouseFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.warehouse === undefined
      ? { id: OTHER_WH, status: WarehouseStatus.ACTIVE }
      : opts.warehouse,
  );
  const client = {
    shipment: { findFirst: shipmentFindFirst, updateMany: shipmentUpdateMany },
    warehouse: { findFirst: warehouseFindFirst },
  };
  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : { orderId: ORDER, status: opts.orderStatus ?? OrderStatus.RTO_IN_TRANSIT },
  );
  const orders = { getById };
  const transitionStatus = jest.fn(async () => ({
    orderId: ORDER,
    status: OrderStatus.RTO_RECEIVED,
  }));
  const orderWrite = { transitionStatus };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  // R4: NORMAL-mode fixtures — no serialized units exist, so the unit
  // ledger is a no-op here. countForShipment returning 0 is what makes
  // the strict gate skip; parcel-grained advances move nothing.
  const unitLedger = {
    countForShipment: jest.fn(async () => 0),
    advanceUnitsForShipment: jest.fn(async () => 0),
    scanUnits: jest.fn(async () => []),
    scanUnitsForShipment: jest.fn(async () => 0),
  };
  // The money side is exercised in rto-fee-accrual.service.spec.ts and
  // end to end; here it is a stub so a wallet failure cannot be mistaken
  // for a receive failure.
  const rtoFees = {
    chargeOnReceive: jest.fn(async () => ({ deliveryFeeSwept: false, rtoFeeInr: '30.00' })),
  };
  const svc = new RtoReceiptService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    audit as unknown as AuditLogService,
    unitLedger as unknown as StockUnitService,
    rtoFees as unknown as RtoFeeAccrualService,
  );
  return {
    svc,
    shipmentFindFirst,
    shipmentUpdateMany,
    warehouseFindFirst,
    getById,
    transitionStatus,
    auditLog,
  };
}

describe('RtoReceiptService.receive', () => {
  it('happy from RTO_IN_TRANSIT: stamps rtoReceivedAt then transitions → RTO_RECEIVED', async () => {
    const { svc, shipmentUpdateMany, transitionStatus, auditLog } = makeService();
    const r = await svc.receive(AWB, STAFF);

    // Operational stamp BEFORE authoritative transition.
    const stampOrd = shipmentUpdateMany.mock.invocationCallOrder[0] ?? 0;
    const transOrd = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(stampOrd).toBeLessThan(transOrd);

    expect(shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SHIP, rtoReceivedAt: null },
        data: expect.objectContaining({ rtoReceivedAt: expect.any(Date) }),
      }),
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.RTO_RECEIVED,
        expectedFrom: OrderStatus.RTO_IN_TRANSIT,
      }),
    );
    expect(r).toMatchObject({
      shipmentId: SHIP,
      orderId: ORDER,
      awbNumber: AWB,
      status: OrderStatus.RTO_RECEIVED,
      alreadyReceived: false,
    });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'rto.received' }));
  });

  it('happy from RTO_INITIATED: expectedFrom=RTO_INITIATED on the transition', async () => {
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.RTO_INITIATED,
    });
    await svc.receive(AWB, STAFF);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ expectedFrom: OrderStatus.RTO_INITIATED }),
    );
  });

  it('idempotent: already RTO_RECEIVED + stamped → no-op', async () => {
    const stampedAt = new Date('2026-05-20T09:00:00Z');
    const { svc, shipmentUpdateMany, transitionStatus, auditLog } = makeService({
      orderStatus: OrderStatus.RTO_RECEIVED,
      shipment: {
        id: SHIP,
        awbNumber: AWB,
        status: ShipmentStatus.RTO_IN_TRANSIT,
        rtoReceivedAt: stampedAt,
        originWarehouseId: ORIGIN_WH,
        rtoReceivedWarehouseId: null,
        orderShipments: [{ orderId: ORDER }],
      },
    });
    const r = await svc.receive(AWB, STAFF);
    expect(r).toEqual({
      shipmentId: SHIP,
      orderId: ORDER,
      awbNumber: AWB,
      status: OrderStatus.RTO_RECEIVED,
      rtoReceivedAt: stampedAt,
      // R6: no warehouse was ever recorded → falls back to origin.
      rtoReceivedWarehouseId: ORIGIN_WH,
      crossWarehouse: false,
      alreadyReceived: true,
    });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('404 when AWB has no shipment', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.receive(AWB, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects ORDER_NOT_RTO_RECEIVABLE for a non-RTO status (e.g. DELIVERED)', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.DELIVERED });
    await expect(svc.receive(AWB, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_RTO_RECEIVABLE' },
    });
  });

  it('404 when order is missing', async () => {
    const { svc } = makeService({ orderStatus: 'missing' });
    await expect(svc.receive(AWB, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stamp idempotency: updateMany count=0 preserves prior rtoReceivedAt', async () => {
    const prior = new Date('2026-05-20T08:00:00Z');
    const { svc } = makeService({
      stampCount: 0,
      shipment: {
        id: SHIP,
        awbNumber: AWB,
        status: ShipmentStatus.RTO_IN_TRANSIT,
        rtoReceivedAt: prior,
        originWarehouseId: ORIGIN_WH,
        rtoReceivedWarehouseId: null,
        orderShipments: [{ orderId: ORDER }],
      },
      orderStatus: OrderStatus.RTO_IN_TRANSIT,
    });
    const r = await svc.receive(AWB, STAFF);
    expect(r.rtoReceivedAt).toBe(prior); // preserves original timestamp on retry
  });

  // ── R6: receiving warehouse ──────────────────────────────────────────

  it('R6: no warehouseId supplied → falls back to origin, no warehouse lookup, LOW audit', async () => {
    const { svc, warehouseFindFirst, shipmentUpdateMany, auditLog } = makeService();
    const r = await svc.receive(AWB, STAFF);
    expect(warehouseFindFirst).not.toHaveBeenCalled();
    // Does NOT write rtoReceivedWarehouseId when the caller didn't name one.
    const data = shipmentUpdateMany.mock.calls[0]![0]!.data as AnyArgs;
    expect('rtoReceivedWarehouseId' in data).toBe(false);
    expect(r.rtoReceivedWarehouseId).toBe(ORIGIN_WH);
    expect(r.crossWarehouse).toBe(false);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rto.received', severity: 'LOW' }),
    );
  });

  it('R6: same-warehouse receipt records it but is NOT flagged cross-warehouse', async () => {
    const { svc, shipmentUpdateMany, auditLog, warehouseFindFirst } = makeService({
      warehouse: { id: ORIGIN_WH, status: WarehouseStatus.ACTIVE },
    });
    const r = await svc.receive(AWB, STAFF, undefined, ORIGIN_WH);
    expect(warehouseFindFirst).toHaveBeenCalled();
    const data = shipmentUpdateMany.mock.calls[0]![0]!.data as AnyArgs;
    expect(data.rtoReceivedWarehouseId).toBe(ORIGIN_WH);
    expect(r.crossWarehouse).toBe(false);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rto.received', severity: 'LOW' }),
    );
  });

  it('R6: cross-warehouse receipt is recorded + audited MEDIUM with a distinct action', async () => {
    const { svc, shipmentUpdateMany, auditLog } = makeService();
    const r = await svc.receive(AWB, STAFF, undefined, OTHER_WH);
    const data = shipmentUpdateMany.mock.calls[0]![0]!.data as AnyArgs;
    expect(data.rtoReceivedWarehouseId).toBe(OTHER_WH);
    expect(r.rtoReceivedWarehouseId).toBe(OTHER_WH);
    expect(r.crossWarehouse).toBe(true);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rto.received_cross_warehouse',
        severity: 'MEDIUM',
        metadata: expect.objectContaining({
          originWarehouseId: ORIGIN_WH,
          rtoReceivedWarehouseId: OTHER_WH,
          crossWarehouse: true,
        }),
      }),
    );
  });

  it('R6: unknown warehouseId → 404 WAREHOUSE_NOT_FOUND, no stamp written', async () => {
    const { svc, shipmentUpdateMany } = makeService({ warehouse: null });
    await expect(svc.receive(AWB, STAFF, undefined, 'wh-nope')).rejects.toMatchObject({
      response: { code: 'WAREHOUSE_NOT_FOUND' },
    });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
  });

  it('R6: non-ACTIVE warehouse → 409 WAREHOUSE_NOT_ACTIVE, no stamp written', async () => {
    const { svc, shipmentUpdateMany } = makeService({
      warehouse: { id: OTHER_WH, status: WarehouseStatus.MAINTENANCE },
    });
    await expect(svc.receive(AWB, STAFF, undefined, OTHER_WH)).rejects.toMatchObject({
      response: { code: 'WAREHOUSE_NOT_ACTIVE' },
    });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
  });

  it('R6: a re-submit with a DIFFERENT warehouse does not rewrite the original record', async () => {
    const stampedAt = new Date('2026-05-20T09:00:00Z');
    const { svc, shipmentUpdateMany } = makeService({
      orderStatus: OrderStatus.RTO_RECEIVED,
      shipment: {
        id: SHIP,
        awbNumber: AWB,
        status: ShipmentStatus.RTO_IN_TRANSIT,
        rtoReceivedAt: stampedAt,
        originWarehouseId: ORIGIN_WH,
        rtoReceivedWarehouseId: OTHER_WH,
        orderShipments: [{ orderId: ORDER }],
      },
      warehouse: { id: ORIGIN_WH, status: WarehouseStatus.ACTIVE },
    });
    const r = await svc.receive(AWB, STAFF, undefined, ORIGIN_WH);
    expect(r.alreadyReceived).toBe(true);
    expect(r.rtoReceivedWarehouseId).toBe(OTHER_WH); // original stands
    expect(r.crossWarehouse).toBe(true);
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
  });
});
