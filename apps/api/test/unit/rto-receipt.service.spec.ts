import { NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  ShipmentStatus,
  StockMovementType,
  StockUnitStatus,
  SystemIssueSeverity,
  WarehouseStatus,
} from '@skydrop/db';
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
    /** WMS-8e — the parcel's lines. Default: one line of 2, never picked. */
    items?: AnyArgs[];
    /** PACK_CONFIRM / DISPATCH movements for the order. Default: none. */
    leftMovements?: AnyArgs[];
    /** The receiving warehouse's RTO_HOLD bin; null = none. */
    holdBinId?: string | null;
    /** A RETURN_RECEIVE already on the ledger for this shipment. */
    priorBooking?: boolean;
    /** The booking transaction throws. */
    bookingThrows?: boolean;
  } = {},
) {
  const defaultShipment = {
    id: SHIP,
    awbNumber: AWB,
    status: ShipmentStatus.RTO_IN_TRANSIT,
    rtoReceivedAt: null,
    originWarehouseId: ORIGIN_WH,
    rtoReceivedWarehouseId: null,
    orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
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
  const items = opts.items ?? [
    {
      id: 'si-1',
      orderItemId: 'oi-1',
      quantity: 2,
      pickedBinId: null,
      pickedBatchId: null,
      orderItem: { variantId: 'v-1', order: { sellerId: 'seller-1' } },
    },
  ];
  const stockMovementFindFirst = jest.fn(async () =>
    opts.priorBooking === true ? { id: 'mv-prior' } : null,
  );
  const stockMovementFindMany = jest.fn(async (args: { where: AnyArgs }) =>
    args.where['type'] === StockMovementType.PACK_REVERSED ? [] : (opts.leftMovements ?? []),
  );
  const client = {
    shipment: { findFirst: shipmentFindFirst, updateMany: shipmentUpdateMany },
    warehouse: { findFirst: warehouseFindFirst },
    shipmentItem: { findMany: jest.fn(async () => items) },
    stockMovement: { findFirst: stockMovementFindFirst, findMany: stockMovementFindMany },
    // Post-transition best-effort steps (fees, unit ledger) run in a tx.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
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
  // WMS-8e — the booking into the returns hold (INV-1 writer + targets).
  let mv = 0;
  const apply = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => {
    mv += 1;
    return { movementId: `mv-${mv}` };
  });
  const runWithRetry = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    if (opts.bookingThrows === true) throw new Error('boom');
    return fn({});
  });
  const holdBinId = jest.fn(async () =>
    opts.holdBinId === undefined ? 'bin-hold' : opts.holdBinId,
  );
  const bookingBatch = jest.fn(async (_tx: unknown, i: AnyArgs) =>
    i['receivedWarehouseId'] === i['originWarehouseId']
      ? (i['pickedBatchId'] as string)
      : 'batch-child',
  );
  const issues = {
    raise: jest.fn(async () => ({ id: 'issue-1', isNew: true })),
    resolveByKey: jest.fn(async () => 0),
  };
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
    // Not on hold — see seller-restriction.service.spec.
    { assertAllowed: async () => undefined } as never,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    audit as unknown as AuditLogService,
    unitLedger as unknown as StockUnitService,
    rtoFees as unknown as RtoFeeAccrualService,
    // Charges are ensured before the RTO fee: the ₹200 delivery leg is
    // swept from the order's charge rows, so an order with none is
    // billed the ₹30 return fee alone.
    { persistForOrderSystem: rtoPersistCharges } as never,
    // The scan-time reader. Empty by default: these tests are about
    // receiving and finalising, not about how long something waited.
    { reachedStatusAt: async () => new Map() } as never,
    { apply, runWithRetry } as never,
    { holdBinId, bookingBatch } as never,
    issues as never,
  );
  return {
    svc,
    apply,
    runWithRetry,
    holdBinId,
    bookingBatch,
    issues,
    advanceUnits: unitLedger.advanceUnitsForShipment,
    shipmentFindFirst,
    shipmentUpdateMany,
    warehouseFindFirst,
    getById,
    transitionStatus,
    auditLog,
  };
}

const rtoPersistCharges = jest.fn(async () => ({ skipped: true, reason: 'CHARGES_ALREADY_EXIST' }));

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
        orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
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
      holdBooking: { outcome: 'SKIPPED', unitsBooked: 0, lines: [] },
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
        orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
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
        orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
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

/** A PACK_CONFIRM for the default line (the unit leaving stock at pack). */
function packConfirm(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'pc-1',
    warehouseId: ORIGIN_WH,
    binId: 'bin-shelf',
    batchId: 'bat-1',
    qtyChange: -2,
    orderItemId: 'oi-1',
    variantId: 'v-1',
    ...over,
  };
}

describe('RtoReceiptService.receive — booked into the returns hold (WMS-8e)', () => {
  it('books each unit that left through us into the hold, after the stamp and BEFORE the transition', async () => {
    const { svc, apply, shipmentUpdateMany, transitionStatus, issues } = makeService({
      leftMovements: [packConfirm()],
    });
    const r = await svc.receive(AWB, STAFF);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1]).toMatchObject({
      type: StockMovementType.RETURN_RECEIVE,
      qtyChange: 2,
      warehouseId: ORIGIN_WH,
      binId: 'bin-hold',
      batchId: 'bat-1', // the batch it left from — same warehouse
      shipmentId: SHIP,
      orderId: ORDER,
      orderItemId: 'oi-1',
      reasonCode: null,
      metadata: {
        shipmentItemId: 'si-1',
        leftFromWarehouseId: ORIGIN_WH,
        leftFromBinId: 'bin-shelf',
        leftFromBatchId: 'bat-1',
      },
    });
    const stampOrd = shipmentUpdateMany.mock.invocationCallOrder[0] ?? 0;
    const bookOrd = apply.mock.invocationCallOrder[0] ?? 0;
    const transOrd = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(stampOrd).toBeLessThan(bookOrd);
    expect(bookOrd).toBeLessThan(transOrd);

    expect(r.holdBooking).toEqual({
      outcome: 'BOOKED',
      unitsBooked: 2,
      lines: [{ shipmentItemId: 'si-1', quantity: 2, binId: 'bin-hold', batchId: 'bat-1' }],
    });
    // A successful booking clears the warehouse's missing-hold issue.
    expect(issues.resolveByKey).toHaveBeenCalledWith(
      `rto-hold-bin-missing:${ORIGIN_WH}`,
      expect.any(String),
    );
    expect(issues.raise).not.toHaveBeenCalled();
  });

  it('a unit booked into the hold is IN STOCK there; the rest of the parcel waits as RTO_RECEIVED', async () => {
    const { svc, advanceUnits } = makeService({ leftMovements: [packConfirm()] });
    await svc.receive(AWB, STAFF);
    const calls = advanceUnits.mock.calls.map((c) => (c as unknown[])[1] as AnyArgs);
    expect(calls[0]).toMatchObject({
      shipmentItemId: 'si-1',
      fromStatus: StockUnitStatus.DISPATCHED,
      toStatus: StockUnitStatus.IN_STOCK,
      binId: 'bin-hold',
      batchId: 'bat-1',
      gate: 'RTO_RECEIVE',
    });
    expect(calls[1]).toMatchObject({
      fromStatus: StockUnitStatus.DISPATCHED,
      toStatus: StockUnitStatus.RTO_RECEIVED,
    });
    expect(calls[1]).not.toHaveProperty('shipmentItemId');
  });

  it('a cross-warehouse return is booked at the RECEIVING warehouse, in the lineage child batch', async () => {
    const { svc, apply, bookingBatch } = makeService({ leftMovements: [packConfirm()] });
    await svc.receive(AWB, STAFF, undefined, OTHER_WH);
    expect(bookingBatch.mock.calls[0]![1]).toMatchObject({
      originWarehouseId: ORIGIN_WH,
      receivedWarehouseId: OTHER_WH,
      pickedBatchId: 'bat-1',
      quantity: 2,
    });
    expect(apply.mock.calls[0]![1]).toMatchObject({
      warehouseId: OTHER_WH,
      batchId: 'batch-child',
    });
  });

  it('less left than the line holds → books exactly what left', async () => {
    const { svc, apply } = makeService({
      items: [
        {
          id: 'si-1',
          orderItemId: 'oi-1',
          quantity: 3,
          pickedBinId: null,
          pickedBatchId: null,
          orderItem: { variantId: 'v-1', order: { sellerId: 'seller-1' } },
        },
      ],
      leftMovements: [packConfirm({ qtyChange: -2 })],
    });
    const r = await svc.receive(AWB, STAFF);
    expect(apply.mock.calls[0]![1]).toMatchObject({ qtyChange: 2 });
    expect(r.holdBooking.unitsBooked).toBe(2);
  });

  it('never left our stock (no pack evidence, a hint at most) → nothing booked, no issue', async () => {
    const { svc, apply, issues, transitionStatus } = makeService({
      items: [
        {
          id: 'si-1',
          orderItemId: 'oi-1',
          quantity: 1,
          pickedBinId: 'bin-hint',
          pickedBatchId: 'bat-hint',
          orderItem: { variantId: 'v-1', order: { sellerId: 'seller-1' } },
        },
      ],
      leftMovements: [],
    });
    const r = await svc.receive(AWB, STAFF);
    expect(apply).not.toHaveBeenCalled();
    expect(issues.raise).not.toHaveBeenCalled();
    expect(r.holdBooking.outcome).toBe('NOTHING_TO_BOOK');
    expect(transitionStatus).toHaveBeenCalled();
  });

  it('no RTO_HOLD bin → the receive is recorded, nothing is booked, and a MEDIUM issue says so', async () => {
    const { svc, apply, issues, transitionStatus } = makeService({
      leftMovements: [packConfirm()],
      holdBinId: null,
    });
    const r = await svc.receive(AWB, STAFF);
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).toHaveBeenCalled();
    expect(r.status).toBe(OrderStatus.RTO_RECEIVED);
    expect(r.holdBooking).toEqual({ outcome: 'NO_HOLD_BIN', unitsBooked: 0, lines: [] });
    expect(issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: SystemIssueSeverity.MEDIUM,
        dedupeKey: `rto-hold-bin-missing:${ORIGIN_WH}`,
        metadata: expect.objectContaining({ shipmentId: SHIP, unitsNotBooked: 2 }),
      }),
    );
  });

  it('a failed booking never blocks the receive', async () => {
    const { svc, transitionStatus } = makeService({
      leftMovements: [packConfirm()],
      bookingThrows: true,
    });
    const r = await svc.receive(AWB, STAFF);
    expect(transitionStatus).toHaveBeenCalled();
    expect(r.holdBooking.outcome).toBe('FAILED');
  });

  it('only the call that WON the stamp books — a concurrent / retried receive books nothing', async () => {
    const { svc, apply, runWithRetry } = makeService({
      leftMovements: [packConfirm()],
      stampCount: 0,
      shipment: {
        id: SHIP,
        awbNumber: AWB,
        status: ShipmentStatus.RTO_IN_TRANSIT,
        rtoReceivedAt: new Date('2026-09-14T08:00:00Z'),
        originWarehouseId: ORIGIN_WH,
        rtoReceivedWarehouseId: null,
        orderShipments: [{ orderId: ORDER, order: { sellerId: 'seller-1' } }],
      },
    });
    const r = await svc.receive(AWB, STAFF);
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(r.holdBooking.outcome).toBe('SKIPPED');
  });

  it('gate: a booking already on the ledger for the shipment is never written twice', async () => {
    const { svc, apply } = makeService({ leftMovements: [packConfirm()], priorBooking: true });
    const r = await svc.receive(AWB, STAFF);
    expect(apply).not.toHaveBeenCalled();
    expect(r.holdBooking.outcome).toBe('SKIPPED');
  });
});
