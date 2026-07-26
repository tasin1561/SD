import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InventoryMode, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PickExecutionService } from '../../src/modules/warehouse-pick/services/pick-execution.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { PickAllocationService } from '../../src/modules/warehouse-pick/services/pick-allocation.service';
import type { AppliedAllocation } from '../../src/modules/inventory-stock/services/stock-pick-allocation.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';

type AnyArgs = Record<string, unknown>;

const STAFF = 'staff-1';
const SHIP = 'ship-1';
const ORDER = 'order-1';

const applied = (over: Partial<AppliedAllocation> = {}): AppliedAllocation => ({
  reservationId: 'rsv',
  strategy: 'SINGLE_BATCH',
  allocatedQty: 5,
  shortfall: 0,
  phase2ReservationIds: ['rsv'],
  residualReservationId: null,
  alreadyAllocated: false,
  ...over,
});

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    orderStatus?: OrderStatus | 'missing';
    active?: Array<{ id: string; orderItemId: string; qtyReserved: number }>;
    allocate?: jest.Mock;
    shipmentItems?: Array<{
      id: string;
      pickedBinId: string | null;
      pickedBatchId: string | null;
    }>;
    findItem?: AnyArgs | null;
    stampCount?: number;
    /** R4: flips the SKU into STRICT so the scan gate engages. */
    inventoryMode?: InventoryMode;
    scanUnitsImpl?: jest.Mock;
  } = {},
) {
  const defaultShipment = {
    id: SHIP,
    status: ShipmentStatus.CREATED,
    pickStartedAt: new Date('2026-05-19T08:00:00Z'),
    pickStartedByStaffId: STAFF,
    pickCompletedAt: null,
    orderShipments: [{ orderId: ORDER }],
  };
  const shipmentFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () =>
      opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const shipmentItemFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () =>
      opts.findItem === undefined
        ? {
            id: 'si-1',
            shipmentId: SHIP,
            quantity: 2,
            // R4: recordItem resolves the line's SKU + owner to decide
            // whether the strict scan gate applies.
            orderItem: { variantId: 'v-1', order: { sellerId: 'seller-1' } },
          }
        : opts.findItem,
  );
  const shipmentItemFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () =>
      opts.shipmentItems ?? [
        { id: 'si-1', pickedBinId: 'bin-1', pickedBatchId: 'bat-1' },
      ],
  );
  const shipmentItemUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(
    async () => ({}),
  );
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(
    async () => ({ count: opts.stampCount ?? 1 }),
  );
  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    shipment: { findFirst: shipmentFindFirst, updateMany: shipmentUpdateMany },
    shipmentItem: {
      findUnique: shipmentItemFindUnique,
      findMany: shipmentItemFindMany,
      update: shipmentItemUpdate,
    },
  };

  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : { orderId: ORDER, status: opts.orderStatus ?? OrderStatus.CONFIRMED },
  );
  const orders = { getById };
  const transitionStatus = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (i) => ({
    orderId: ORDER,
    status: (i as { to: OrderStatus }).to,
  }));
  const orderWrite = { transitionStatus };
  const listActiveForOrder = jest.fn(async () => opts.active ?? []);
  const reservations = { listActiveForOrder };
  const allocateForPick =
    opts.allocate ?? jest.fn(async () => applied());
  const allocation = { allocateForPick };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  // R4: NORMAL-mode fixtures — no serialized units exist, so the unit
  // ledger is a no-op here. countForShipment returning 0 is what makes
  // the strict gate skip; parcel-grained advances move nothing.
  const unitLedger = {
    countForShipment: jest.fn(async () => 0),
    advanceUnitsForShipment: jest.fn(async () => 0),
    scanUnits: opts.scanUnitsImpl ?? jest.fn(async () => ['u-1', 'u-2']),
    scanUnitsForShipment: jest.fn(async () => 0),
  };
  const modes = {
    resolveForVariant: jest.fn(
      async () => opts.inventoryMode ?? InventoryMode.NORMAL,
    ),
  };
  const svc = new PickExecutionService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    reservations as unknown as StockReservationService,
    allocation as unknown as PickAllocationService,
    audit as unknown as AuditLogService,
    modes as unknown as InventoryModeService,
    unitLedger as unknown as StockUnitService,
  );
  return {
    svc,
    shipmentFindFirst,
    shipmentItemFindUnique,
    shipmentItemFindMany,
    shipmentItemUpdate,
    shipmentUpdateMany,
    getById,
    transitionStatus,
    listActiveForOrder,
    allocateForPick,
    auditLog,
    unitLedger,
  };
}

describe('PickExecutionService.start', () => {
  it('CONFIRMED → PENDING_PICK, full allocation, audits started', async () => {
    const { svc, transitionStatus, allocateForPick, auditLog } = makeService({
      orderStatus: OrderStatus.CONFIRMED,
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 5 }],
    });
    const r = await svc.start(SHIP, STAFF);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER,
        to: OrderStatus.PENDING_PICK,
        expectedFrom: OrderStatus.CONFIRMED,
      }),
    );
    expect(allocateForPick).toHaveBeenCalledWith('r1', expect.anything());
    expect(r).toMatchObject({
      status: OrderStatus.PENDING_PICK,
      fullyAllocated: true,
    });
    expect(r.allocations).toHaveLength(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'warehouse_pick.started' }),
    );
  });

  it('re-pick: order already PENDING_PICK skips the CONFIRMED transition', async () => {
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 5 }],
    });
    const r = await svc.start(SHIP, STAFF);
    expect(transitionStatus).not.toHaveBeenCalled(); // no CONFIRMED→ + no escalate
    expect(r.status).toBe(OrderStatus.PENDING_PICK);
  });

  it('rejects ORDER_NOT_PICKABLE when the order is in a non-pick state', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.CANCELLED });
    await expect(svc.start(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_PICKABLE' },
    });
  });

  it('no ACTIVE reservations → fail-route to PENDING_MANUAL_PLACEMENT', async () => {
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.CONFIRMED,
      active: [],
    });
    const r = await svc.start(SHIP, STAFF);
    // 1st: CONFIRMED→PENDING_PICK, 2nd: PENDING_PICK→PENDING_MANUAL_PLACEMENT
    expect(transitionStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: OrderStatus.PENDING_MANUAL_PLACEMENT,
        expectedFrom: OrderStatus.PENDING_PICK,
      }),
    );
    expect(r).toMatchObject({
      status: OrderStatus.PENDING_MANUAL_PLACEMENT,
      fullyAllocated: false,
    });
  });

  it('allocation shortfall → WMS-4 PENDING_MANUAL_PLACEMENT', async () => {
    const allocate = jest.fn(async () =>
      applied({ strategy: 'PARTIAL', allocatedQty: 2, shortfall: 3 }),
    );
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.CONFIRMED,
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 5 }],
      allocate,
    });
    const r = await svc.start(SHIP, STAFF);
    expect(r.status).toBe(OrderStatus.PENDING_MANUAL_PLACEMENT);
    expect(r.fullyAllocated).toBe(false);
    expect(transitionStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: OrderStatus.PENDING_MANUAL_PLACEMENT }),
    );
  });

  it('allocateForPick RETRY_EXHAUSTED is caught → PENDING_MANUAL_PLACEMENT (no 500)', async () => {
    const allocate = jest.fn(async () => {
      throw new ConflictException({ code: 'PICK_ALLOCATION_RETRY_EXHAUSTED' });
    });
    const { svc } = makeService({
      orderStatus: OrderStatus.CONFIRMED,
      active: [{ id: 'r1', orderItemId: 'oi1', qtyReserved: 5 }],
      allocate,
    });
    const r = await svc.start(SHIP, STAFF);
    expect(r.status).toBe(OrderStatus.PENDING_MANUAL_PLACEMENT);
    expect(r.allocations[0]).toMatchObject({ shortfall: 5, strategy: 'NONE' });
  });

  it('guards: 403 when claimed by another picker', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        pickStartedAt: new Date(),
        pickStartedByStaffId: 'someone-else',
        pickCompletedAt: null,
        orderShipments: [{ orderId: ORDER }],
      },
    });
    await expect(svc.start(SHIP, STAFF)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('guards: 409 PICK_NOT_CLAIMED when never pulled', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        pickStartedAt: null,
        pickStartedByStaffId: null,
        pickCompletedAt: null,
        orderShipments: [{ orderId: ORDER }],
      },
    });
    await expect(svc.start(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'PICK_NOT_CLAIMED' },
    });
  });

  it('guards: 404 when the shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.start(SHIP, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PickExecutionService.recordItem', () => {
  it('STRICT: rejects a scan count that does not match the line quantity, and records NOTHING', async () => {
    const { svc, shipmentItemUpdate, unitLedger } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
      inventoryMode: InventoryMode.STRICT,
    });
    // The fixture line has quantity 2; one serial is not enough.
    await expect(
      svc.recordItem(SHIP, STAFF, {
        shipmentItemId: 'si-1',
        pickedBinId: 'bin-9',
        pickedBatchId: 'bat-9',
        scannedSerials: ['S1'],
      }),
    ).rejects.toMatchObject({ response: { code: 'UNIT_SCAN_COUNT_MISMATCH' } });
    // A rejected scan must leave the line un-recorded, else `complete`
    // would pass a parcel whose units were never accounted for.
    expect(shipmentItemUpdate).not.toHaveBeenCalled();
    expect(unitLedger.scanUnits).not.toHaveBeenCalled();
  });

  it('STRICT: a missing scannedSerials array is treated as zero scans, not as opt-out', async () => {
    const { svc } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
      inventoryMode: InventoryMode.STRICT,
    });
    await expect(
      svc.recordItem(SHIP, STAFF, {
        shipmentItemId: 'si-1',
        pickedBinId: 'bin-9',
        pickedBatchId: 'bat-9',
      }),
    ).rejects.toMatchObject({ response: { code: 'UNIT_SCAN_COUNT_MISMATCH' } });
  });

  it('STRICT: an exact scan moves the units and records the hint in the same tx', async () => {
    const { svc, shipmentItemUpdate, unitLedger } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
      inventoryMode: InventoryMode.STRICT,
    });
    const r = await svc.recordItem(SHIP, STAFF, {
      shipmentItemId: 'si-1',
      pickedBinId: 'bin-9',
      pickedBatchId: 'bat-9',
      scannedSerials: ['S1', 'S2'],
    });
    expect(r.unitsScanned).toBe(2);
    expect(unitLedger.scanUnits).toHaveBeenCalledTimes(1);
    expect(shipmentItemUpdate).toHaveBeenCalledTimes(1);
    const scanArgs = unitLedger.scanUnits.mock.calls[0]?.[1] as AnyArgs;
    expect(scanArgs).toMatchObject({
      serials: ['S1', 'S2'],
      shipmentItemId: 'si-1',
      gate: 'PICK',
    });
  });

  it('NORMAL: serials are ignored entirely — every pre-R4 caller keeps working', async () => {
    const { svc, unitLedger } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
    });
    const r = await svc.recordItem(SHIP, STAFF, {
      shipmentItemId: 'si-1',
      pickedBinId: 'bin-9',
      pickedBatchId: 'bat-9',
      scannedSerials: ['STRAY'],
    });
    expect(r.unitsScanned).toBe(0);
    expect(unitLedger.scanUnits).not.toHaveBeenCalled();
  });

  it('records the bin/batch hint + audits', async () => {
    const { svc, shipmentItemUpdate, auditLog } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
    });
    const r = await svc.recordItem(SHIP, STAFF, {
      shipmentItemId: 'si-1',
      pickedBinId: 'bin-9',
      pickedBatchId: 'bat-9',
    });
    expect(shipmentItemUpdate).toHaveBeenCalledWith({
      where: { id: 'si-1' },
      data: { pickedBinId: 'bin-9', pickedBatchId: 'bat-9' },
    });
    expect(r).toEqual({
      shipmentItemId: 'si-1',
      pickedBinId: 'bin-9',
      pickedBatchId: 'bat-9',
      unitsScanned: 0,
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'warehouse_pick.item_recorded' }),
    );
  });

  it('rejects when the order is not PENDING_PICK', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.CONFIRMED });
    await expect(
      svc.recordItem(SHIP, STAFF, {
        shipmentItemId: 'si-1',
        pickedBinId: 'b',
        pickedBatchId: 'c',
      }),
    ).rejects.toMatchObject({ response: { code: 'PICK_NOT_IN_PROGRESS' } });
  });

  it('rejects an item that belongs to another shipment', async () => {
    const { svc } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
      findItem: { id: 'si-1', shipmentId: 'other-ship' },
    });
    await expect(
      svc.recordItem(SHIP, STAFF, {
        shipmentItemId: 'si-1',
        pickedBinId: 'b',
        pickedBatchId: 'c',
      }),
    ).rejects.toMatchObject({ response: { code: 'SHIPMENT_ITEM_NOT_FOUND' } });
  });
});

describe('PickExecutionService.complete', () => {
  it('all items recorded → stamp + PENDING_PICK → PICKED', async () => {
    const { svc, shipmentUpdateMany, transitionStatus } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
      shipmentItems: [
        { id: 'si-1', pickedBinId: 'b1', pickedBatchId: 'k1' },
        { id: 'si-2', pickedBinId: 'b2', pickedBatchId: 'k2' },
      ],
    });
    const r = await svc.complete(SHIP, STAFF);
    // operational stamp BEFORE the authoritative transition
    const stampOrder = shipmentUpdateMany.mock.invocationCallOrder[0] ?? 0;
    const transOrder = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(stampOrder).toBeLessThan(transOrder);
    expect(shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pickCompletedAt: null }),
        data: expect.objectContaining({ pickExpiresAt: null }),
      }),
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.PICKED,
        expectedFrom: OrderStatus.PENDING_PICK,
      }),
    );
    expect(r).toMatchObject({
      status: OrderStatus.PICKED,
      alreadyComplete: false,
    });
  });

  it('idempotent: already PICKED + pickCompletedAt set → no-op', async () => {
    const done = new Date('2026-05-19T09:00:00Z');
    const { svc, transitionStatus, shipmentUpdateMany } = makeService({
      orderStatus: OrderStatus.PICKED,
      shipment: {
        id: SHIP,
        status: ShipmentStatus.CREATED,
        pickStartedAt: new Date('2026-05-19T08:00:00Z'),
        pickStartedByStaffId: STAFF,
        pickCompletedAt: done,
        orderShipments: [{ orderId: ORDER }],
      },
    });
    const r = await svc.complete(SHIP, STAFF);
    expect(r).toEqual({
      shipmentId: SHIP,
      orderId: ORDER,
      status: OrderStatus.PICKED,
      pickCompletedAt: done,
      alreadyComplete: true,
    });
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects PICK_INCOMPLETE when an item has no recorded bin/batch', async () => {
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.PENDING_PICK,
      shipmentItems: [
        { id: 'si-1', pickedBinId: 'b1', pickedBatchId: 'k1' },
        { id: 'si-2', pickedBinId: null, pickedBatchId: null },
      ],
    });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'PICK_INCOMPLETE' },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('rejects when order is not PENDING_PICK (and not idempotent)', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.CONFIRMED });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'PICK_NOT_IN_PROGRESS' },
    });
  });
});
