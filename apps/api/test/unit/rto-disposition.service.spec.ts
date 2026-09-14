import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
  RtoItemCondition,
  StockMovementReasonCode,
  StockMovementType,
} from '@skydrop/db';
import { RtoDispositionService } from '../../src/modules/warehouse-rto/services/rto-disposition.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { StockMutationService } from '../../src/modules/inventory-shared/stock-mutation.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';
import type { RtoRestockTargetService } from '../../src/modules/warehouse-rto/services/rto-restock-target.service';
import type { InboundFreightAmortisationService } from '../../src/modules/inbound-freight/services/inbound-freight-amortisation.service';

type AnyArgs = Record<string, unknown>;

const SHIP = 'ship-1';
const ORDER = 'order-1';
const SELLER = 'seller-1';
const WH = 'wh-1';
const STAFF = 'staff-1';

function item(
  id: string,
  disposition: RtoDisposition | null,
  opts: {
    quantity?: number;
    variantId?: string;
    pickedBin?: string | null;
    pickedBatch?: string | null;
    rtoCondition?: RtoItemCondition | null;
    /** WMS-8d — the line split by quantity. Absent ⇒ the summary columns. */
    rows?: Array<{
      quantity: number;
      condition: RtoItemCondition;
      disposition: RtoDisposition;
      notes?: string | null;
    }>;
  } = {},
): AnyArgs {
  return {
    id,
    orderItemId: `oi-${id}`,
    quantity: opts.quantity ?? 2,
    rtoCondition: opts.rtoCondition === undefined ? RtoItemCondition.GOOD : opts.rtoCondition,
    rtoDisposition: disposition,
    ...(opts.rows === undefined
      ? {}
      : { rtoInspections: opts.rows.map((r) => ({ notes: null, ...r })) }),
    pickedBinId: opts.pickedBin === undefined ? 'bin-1' : opts.pickedBin,
    pickedBatchId: opts.pickedBatch === undefined ? 'bat-1' : opts.pickedBatch,
    orderItem: {
      id: `oi-${id}`,
      variantId: opts.variantId ?? `v-${id}`,
      skuCode: `SKU-${id}`,
      order: { sellerId: SELLER },
    },
  };
}

/** A PACK_CONFIRM movement for an order item (the unit leaving stock). */
function packConfirm(
  id: string,
  opts: {
    orderItemId?: string;
    variantId?: string;
    bin?: string;
    batch?: string;
    qty?: number;
    warehouseId?: string;
  } = {},
): AnyArgs {
  return {
    id,
    warehouseId: opts.warehouseId ?? WH,
    binId: opts.bin ?? 'mv-bin',
    batchId: opts.batch ?? 'mv-bat',
    qtyChange: -(opts.qty ?? 2),
    orderItemId: opts.orderItemId ?? 'oi-si-1',
    variantId: opts.variantId ?? 'v-si-1',
  };
}

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    orderStatus?: OrderStatus | 'missing';
    items?: AnyArgs[];
    existingMovement?: AnyArgs | null;
    /** R6 — where the parcel was physically received. null = origin. */
    rtoReceivedWarehouseId?: string | null;
    /** PACK_CONFIRM / DISPATCH movements for the order. Default: none. */
    leftMovements?: AnyArgs[];
    /** PACK_REVERSED movements for the order. Default: none. */
    reversals?: AnyArgs[];
    /** WMS-8d — the receiving warehouse has no DAMAGED bin. */
    noDamagedBin?: boolean;
    /** WMS-8e — RETURN_RECEIVE bookings for the shipment. Default: none. */
    heldMovements?: AnyArgs[];
  } = {},
) {
  const defaultItems = opts.items ?? [item('si-1', RtoDisposition.RESTOCK)];
  const defaultShipment = {
    id: SHIP,
    originWarehouseId: WH,
    rtoReceivedWarehouseId: opts.rtoReceivedWarehouseId ?? null,
    orderShipments: [{ orderId: ORDER }],
    items: defaultItems,
  };
  const shipmentFindFirst = jest.fn(async () =>
    opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const stockMovementFindFirst = jest.fn(async () =>
    opts.existingMovement === undefined ? null : opts.existingMovement,
  );
  const stockMovementFindMany = jest.fn(async (args: { where: { type: unknown } }) =>
    args.where.type === StockMovementType.RETURN_RECEIVE
      ? (opts.heldMovements ?? [])
      : args.where.type === StockMovementType.PACK_REVERSED
        ? (opts.reversals ?? [])
        : (opts.leftMovements ?? []),
  );
  const client = {
    shipment: { findFirst: shipmentFindFirst },
    stockMovement: { findFirst: stockMovementFindFirst, findMany: stockMovementFindMany },
    // The best-effort post-transition steps (unit ledger, freight debit)
    // each open their own transaction.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : { orderId: ORDER, status: opts.orderStatus ?? OrderStatus.RTO_RECEIVED },
  );
  const orders = { getById };
  const transitionStatus = jest.fn(async () => ({
    orderId: ORDER,
    status: OrderStatus.RTO_RESTOCKED,
  }));
  const orderWrite = { transitionStatus };
  let movementCounter = 0;
  const apply = jest.fn<Promise<AnyArgs>, [unknown, AnyArgs]>(async () => {
    movementCounter += 1;
    return { movementId: `mv-${movementCounter}` };
  });
  const runWithRetry = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  const mutation = { apply, runWithRetry };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  // R4: NORMAL-mode fixtures carry no serialized units, so the unit
  // ledger advance is a no-op (0 rows moved) in every case here.
  const unitLedger = { advanceUnitsForShipment: jest.fn(async () => 0) };
  // R6b: same-warehouse fixtures resolve to the picked bin/batch, i.e.
  // exactly the pre-R6b behaviour these assertions were written against.
  const resolveTarget = jest.fn(async (_tx: unknown, i: AnyArgs) => ({
    warehouseId: i['receivedWarehouseId'] as string,
    binId: i['pickedBinId'] as string,
    batchId: i['pickedBatchId'] as string,
    crossWarehouse: i['receivedWarehouseId'] !== i['originWarehouseId'],
  }));
  // WMS-8d: a kept-aside unit lands in the receiving warehouse's DAMAGED
  // bin, keeping the source batch (same-warehouse fixture).
  const resolveDamagedHold = jest.fn(async (_tx: unknown, i: AnyArgs) => {
    if (opts.noDamagedBin === true) {
      throw new ConflictException({ code: 'RTO_NO_DAMAGED_BIN', message: 'no damaged bin' });
    }
    return {
      warehouseId: i['receivedWarehouseId'] as string,
      binId: 'bin-damaged',
      batchId: i['pickedBatchId'] as string,
      crossWarehouse: i['receivedWarehouseId'] !== i['originWarehouseId'],
    };
  });
  // WMS-8e: where a booked unit goes when it leaves the hold.
  const sellableDestination = jest.fn(async () => ({ binId: 'bin-floor', reason: 'FLOOR' }));
  const damagedBinId = jest.fn(async () => {
    if (opts.noDamagedBin === true) {
      throw new ConflictException({ code: 'RTO_NO_DAMAGED_BIN', message: 'no damaged bin' });
    }
    return 'bin-damaged';
  });
  const restockTargets = {
    resolve: resolveTarget,
    resolveDamagedHold,
    sellableDestination,
    damagedBinId,
  };
  // R3: a written-off unit's freight share. Default fixture charges
  // nothing (goods from no billed consignment), so the existing
  // assertions are unaffected.
  const debitForWrittenOffItems = jest.fn(async () => ({
    amountInr: '0',
    unitsCharged: 0,
    alreadyCharged: false,
  }));
  const freightAmortisation = { debitForWrittenOffItems };
  const svc = new RtoDispositionService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    mutation as unknown as StockMutationService,
    audit as unknown as AuditLogService,
    unitLedger as unknown as StockUnitService,
    restockTargets as unknown as RtoRestockTargetService,
    freightAmortisation as unknown as InboundFreightAmortisationService,
  );
  return {
    svc,
    stockMovementFindFirst,
    stockMovementFindMany,
    transitionStatus,
    apply,
    runWithRetry,
    auditLog,
    resolveTarget,
    resolveDamagedHold,
    sellableDestination,
    damagedBinId,
    debitForWrittenOffItems,
    advanceUnits: unitLedger.advanceUnitsForShipment,
  };
}

/** The pack-evidence query (PACK_CONFIRM / DISPATCH), as opposed to the held one. */
function packEvidenceCalls(findMany: jest.Mock): Array<Record<string, unknown>> {
  return findMany.mock.calls
    .map((c) => (c[0] as { where: Record<string, unknown> }).where)
    .filter((w) => typeof w['type'] === 'object' && w['type'] !== null);
}

describe('RtoDispositionService.finalize — Model A retry-state matrix', () => {
  it('STATE 1 (neither done) RESTOCK: RETURN_RESTOCK +qty movement + transition', async () => {
    const { svc, runWithRetry, apply, transitionStatus, auditLog } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, { quantity: 3 })],
    });
    const r = await svc.finalize(SHIP, STAFF);

    expect(runWithRetry).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: StockMovementType.RETURN_RESTOCK,
        qtyChange: 3, // +qty — the unit returned (Model A)
        binId: 'bin-1',
        batchId: 'bat-1',
        sellerId: SELLER,
        warehouseId: WH,
        actorType: ActorType.STAFF,
        orderId: ORDER,
        shipmentId: SHIP,
        reasonCode: null,
      }),
    );
    // Movement BEFORE transition.
    const movOrd = apply.mock.invocationCallOrder[0] ?? 0;
    const transOrd = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(movOrd).toBeLessThan(transOrd);

    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.RTO_RESTOCKED,
        expectedFrom: OrderStatus.RTO_RECEIVED,
      }),
    );
    expect(r).toMatchObject({
      restockedCount: 1,
      writtenOffCount: 0,
      movementsAlreadyApplied: false,
      alreadyFinalized: false,
    });
    expect(r.items[0]?.movementId).toBe('mv-1');
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'rto.finalized' }));
  });

  it('STATE 1 (neither done) WRITE_OFF: NO movement (decrement stands from dispatch) + transition', async () => {
    const { svc, runWithRetry, apply, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.WRITE_OFF, {
          quantity: 2,
          rtoCondition: RtoItemCondition.DAMAGED,
        }),
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).not.toHaveBeenCalled(); // no RESTOCK items
    expect(apply).not.toHaveBeenCalled();
    // RTO_DAMAGED, not RTO_RESTOCKED. Nothing came back sellable, and
    // this assertion used to say RESTOCKED — encoding a bug that made
    // the damage-rate report structurally incapable of reading non-zero.
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_DAMAGED }),
    );
    expect(r).toMatchObject({
      status: OrderStatus.RTO_DAMAGED,
      restockedCount: 0,
      writtenOffCount: 1,
    });
    expect(r.items[0]?.movementId).toBeNull();
  });

  it('a MIXED parcel is a restock with losses, not a damaged one', async () => {
    // The test is "nothing restocked", not "something written off".
    // Calling a parcel that saved one unit damaged would overstate the
    // damage rate as badly as the old behaviour understated it.
    const { svc, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK),
        item('si-2', RtoDisposition.WRITE_OFF, { rtoCondition: RtoItemCondition.DAMAGED }),
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    expect(r).toMatchObject({ status: OrderStatus.RTO_RESTOCKED, writtenOffCount: 1 });
  });

  it('an already-RTO_DAMAGED order short-circuits too', async () => {
    // Gate 1 previously recognised only RTO_RESTOCKED as finalised, so a
    // retry on a written-off parcel would have tried to transition an
    // order that is already at a terminal.
    const { svc, transitionStatus } = makeService({
      orderStatus: OrderStatus.RTO_DAMAGED,
      items: [item('si-1', RtoDisposition.WRITE_OFF)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: OrderStatus.RTO_DAMAGED, alreadyFinalized: true });
  });

  it('STATE 2 (movements done, transition pending): gate-2 skips re-apply, transition runs', async () => {
    const { svc, runWithRetry, apply, transitionStatus } = makeService({
      existingMovement: { id: 'mv-prior' }, // RETURN_RESTOCK marker exists
      items: [item('si-1', RtoDisposition.RESTOCK)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).toHaveBeenCalled();
    expect(r).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      movementsAlreadyApplied: true,
      alreadyFinalized: false,
    });
  });

  it('STATE 3 (both done): alreadyFinalized short-circuit', async () => {
    const { svc, stockMovementFindFirst, runWithRetry, transitionStatus } = makeService({
      orderStatus: OrderStatus.RTO_RESTOCKED,
      items: [item('si-1', RtoDisposition.RESTOCK), item('si-2', RtoDisposition.WRITE_OFF)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(r).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      restockedCount: 1,
      writtenOffCount: 1,
      movementsAlreadyApplied: true,
      alreadyFinalized: true,
    });
    expect(stockMovementFindFirst).not.toHaveBeenCalled();
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});

describe('RtoDispositionService.finalize — disposition mixes (Model A)', () => {
  it('all-WRITE_OFF: no movements, transition runs', async () => {
    const { svc, runWithRetry, apply } = makeService({
      items: [item('si-1', RtoDisposition.WRITE_OFF), item('si-2', RtoDisposition.WRITE_OFF)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(r.restockedCount).toBe(0);
    expect(r.writtenOffCount).toBe(2);
  });

  it('mixed RESTOCK + WRITE_OFF: ONLY RESTOCK items get a RETURN_RESTOCK movement', async () => {
    const { svc, apply, runWithRetry } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, { quantity: 2 }),
        item('si-2', RtoDisposition.WRITE_OFF, { quantity: 3 }),
        item('si-3', RtoDisposition.RESTOCK, { quantity: 1 }),
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2); // only the 2 RESTOCK items
    expect(r.restockedCount).toBe(2);
    expect(r.writtenOffCount).toBe(1);
    expect(r.items.find((i) => i.shipmentItemId === 'si-2')?.movementId).toBeNull();
  });
});

describe('RtoDispositionService.finalize — where a restock goes back to (2026-09-13)', () => {
  const noHint = { pickedBin: null, pickedBatch: null } as const;

  it('hint missing + one PACK_CONFIRM source → restocks where the unit left', async () => {
    // The production bug: a batch-picked parcel has no pick hint, but its
    // PACK_CONFIRM carries the bin and batch the stock came off.
    const { svc, apply, transitionStatus } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, noHint)],
      leftMovements: [packConfirm('m-1')],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1]).toMatchObject({
      type: StockMovementType.RETURN_RESTOCK,
      binId: 'mv-bin',
      batchId: 'mv-bat',
      qtyChange: 2,
      metadata: expect.objectContaining({ restockSource: 'PACK_MOVEMENT' }),
    });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    expect(r.items[0]?.movementIds).toEqual(['mv-1']);
  });

  it('hint missing + two sources → one RETURN_RESTOCK per source, summing to the line', async () => {
    const { svc, apply, resolveTarget } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, { ...noHint, quantity: 5 })],
      leftMovements: [
        packConfirm('m-1', { bin: 'bin-A', batch: 'bat-A', qty: 2 }),
        packConfirm('m-2', { bin: 'bin-B', batch: 'bat-B', qty: 3 }),
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(apply).toHaveBeenCalledTimes(2);
    const moves = apply.mock.calls.map((c) => c[1]);
    expect(moves).toEqual([
      expect.objectContaining({ binId: 'bin-B', batchId: 'bat-B', qtyChange: 3 }),
      expect.objectContaining({ binId: 'bin-A', batchId: 'bat-A', qtyChange: 2 }),
    ]);
    // Each source goes through the R6b resolver with its own quantity.
    expect(resolveTarget.mock.calls.map((c) => c[1]['quantity'])).toEqual([3, 2]);
    expect(r.items[0]?.movementIds).toEqual(['mv-1', 'mv-2']);
    expect(r.items[0]?.movementId).toBe('mv-1');
  });

  it('a PACK_REVERSED give-back is netted (matched per movement)', async () => {
    const { svc, apply } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, noHint)],
      leftMovements: [
        packConfirm('m-1', { bin: 'bin-old', batch: 'bat-old' }),
        packConfirm('m-2', { bin: 'bin-new', batch: 'bat-new' }),
      ],
      reversals: [{ metadata: { reversesMovementId: 'm-1' } }],
    });
    await svc.finalize(SHIP, STAFF);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1]).toMatchObject({ binId: 'bin-new', batchId: 'bat-new' });
  });

  it('reads pack evidence by ORDER, so a supersede (PACK_CONFIRM on the original shipment) is still found', async () => {
    const { svc, stockMovementFindMany, apply } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, noHint)],
      leftMovements: [{ ...packConfirm('m-1'), shipmentId: 'ship-ORIGINAL' }],
    });
    await svc.finalize(SHIP, STAFF);
    const where = packEvidenceCalls(stockMovementFindMany)[0] ?? {};
    expect(where['orderId']).toBe(ORDER);
    expect(where).not.toHaveProperty('shipmentId');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('a hint that disagrees with the movement loses, and the disagreement is audited', async () => {
    const { svc, apply, auditLog } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, { pickedBin: 'bin-1', pickedBatch: 'bat-1' })],
      leftMovements: [packConfirm('m-1')],
    });
    await svc.finalize(SHIP, STAFF);
    expect(apply.mock.calls[0]![1]).toMatchObject({ binId: 'mv-bin', batchId: 'mv-bat' });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rto.finalized',
        metadata: expect.objectContaining({ hintDisagreements: ['si-1'] }),
      }),
    );
  });

  it('hint present with no pack evidence keeps the legacy hint path, flagged in the audit', async () => {
    const { svc, apply, auditLog } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK)],
    });
    await svc.finalize(SHIP, STAFF);
    expect(apply.mock.calls[0]![1]).toMatchObject({
      binId: 'bin-1',
      batchId: 'bat-1',
      metadata: expect.objectContaining({ restockSource: 'PICK_HINT' }),
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ restockedFromHintOnly: ['si-1'] }),
      }),
    );
  });

  it('more units marked Restock than left → refused for the shortfall, nothing moved', async () => {
    const { svc, apply, transitionStatus } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, { ...noHint, quantity: 3 })],
      leftMovements: [packConfirm('m-1', { qty: 2 })],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_EXCEEDS_STOCK_LEFT' },
    });
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('a WRITE_OFF-only parcel never asks where stock left', async () => {
    const { svc, stockMovementFindMany } = makeService({
      items: [item('si-1', RtoDisposition.WRITE_OFF, noHint)],
    });
    await svc.finalize(SHIP, STAFF);
    expect(packEvidenceCalls(stockMovementFindMany)).toEqual([]);
  });
});

describe('RtoDispositionService.finalize — a line split by quantity (WMS-8d)', () => {
  const noHint = { pickedBin: null, pickedBatch: null } as const;
  const GOOD_RESTOCK = {
    quantity: 1,
    condition: RtoItemCondition.GOOD,
    disposition: RtoDisposition.RESTOCK,
  };
  const DAMAGED_HOLD = {
    quantity: 1,
    condition: RtoItemCondition.DAMAGED,
    disposition: RtoDisposition.HOLD_DAMAGED,
  };
  const DAMAGED_WRITE_OFF = {
    quantity: 1,
    condition: RtoItemCondition.DAMAGED,
    disposition: RtoDisposition.WRITE_OFF,
  };

  it('1 RESTOCK + 1 HOLD_DAMAGED: one unit to the returns hold, one to the DAMAGED bin', async () => {
    const {
      svc,
      apply,
      resolveTarget,
      resolveDamagedHold,
      transitionStatus,
      debitForWrittenOffItems,
    } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, {
          ...noHint,
          quantity: 2,
          rows: [GOOD_RESTOCK, DAMAGED_HOLD],
        }),
      ],
      leftMovements: [packConfirm('m-1', { qty: 2 })],
    });
    const r = await svc.finalize(SHIP, STAFF);

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0]![1]).toMatchObject({
      type: StockMovementType.RETURN_RESTOCK,
      binId: 'mv-bin',
      batchId: 'mv-bat',
      qtyChange: 1,
      metadata: expect.objectContaining({ disposition: 'RESTOCK', inspectionRow: 1 }),
    });
    expect(apply.mock.calls[1]![1]).toMatchObject({
      type: StockMovementType.RETURN_RESTOCK,
      binId: 'bin-damaged',
      batchId: 'mv-bat', // the batch the unit left from — lineage kept
      qtyChange: 1,
      metadata: expect.objectContaining({ disposition: 'HOLD_DAMAGED', inspectionRow: 2 }),
    });
    // Each row went to its own resolver, with its own quantity.
    expect(resolveTarget.mock.calls.map((c) => c[1]['quantity'])).toEqual([1]);
    expect(resolveDamagedHold.mock.calls.map((c) => c[1]['quantity'])).toEqual([1]);
    // A unit came back sellable ⇒ restocked, not damaged.
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    // Nothing written off ⇒ no freight charged; the kept unit has not left.
    expect(debitForWrittenOffItems).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      restockedUnits: 1,
      heldDamagedUnits: 1,
      writtenOffUnits: 0,
      restockedCount: 1,
      heldDamagedCount: 1,
    });
    expect(r.items[0]?.rows).toEqual([
      expect.objectContaining({ disposition: 'RESTOCK', movementIds: ['mv-1'] }),
      expect.objectContaining({ disposition: 'HOLD_DAMAGED', movementIds: ['mv-2'] }),
    ]);
    expect(r.items[0]?.movementIds).toEqual(['mv-1', 'mv-2']);
  });

  it('everything kept aside damaged ⇒ RTO_DAMAGED, nothing charged', async () => {
    const { svc, apply, transitionStatus, debitForWrittenOffItems } = makeService({
      items: [
        item('si-1', RtoDisposition.HOLD_DAMAGED, {
          ...noHint,
          rtoCondition: RtoItemCondition.DAMAGED,
        }),
      ],
      leftMovements: [packConfirm('m-1', { qty: 2 })],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1]).toMatchObject({ binId: 'bin-damaged', qtyChange: 2 });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_DAMAGED }),
    );
    expect(debitForWrittenOffItems).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: OrderStatus.RTO_DAMAGED, heldDamagedUnits: 2 });
  });

  it('1 RESTOCK + 1 WRITE_OFF: restocks one unit, charges freight for ONE unit', async () => {
    const { svc, apply, debitForWrittenOffItems } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, {
          ...noHint,
          quantity: 2,
          rows: [GOOD_RESTOCK, DAMAGED_WRITE_OFF],
        }),
      ],
      leftMovements: [packConfirm('m-1', { qty: 2 })],
    });
    await svc.finalize(SHIP, STAFF);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1]).toMatchObject({ qtyChange: 1 });
    expect(debitForWrittenOffItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lines: [{ shipmentItemId: 'si-1', quantity: 1 }] }),
    );
  });

  it('the EXCEEDS guard covers every returning row of the line together', async () => {
    // 1 restock + 1 kept aside = 2 coming back, only 1 left through us.
    const { svc, apply, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, {
          ...noHint,
          quantity: 2,
          rows: [GOOD_RESTOCK, DAMAGED_HOLD],
        }),
      ],
      leftMovements: [packConfirm('m-1', { qty: 1 })],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_EXCEEDS_STOCK_LEFT' },
    });
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('no DAMAGED bin ⇒ RTO_NO_DAMAGED_BIN, no transition (the movement tx rolls back)', async () => {
    const { svc, transitionStatus } = makeService({
      noDamagedBin: true,
      items: [
        item('si-1', RtoDisposition.RESTOCK, {
          ...noHint,
          quantity: 2,
          rows: [GOOD_RESTOCK, DAMAGED_HOLD],
        }),
      ],
      leftMovements: [packConfirm('m-1', { qty: 2 })],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_NO_DAMAGED_BIN' },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('rows that do not add up to the line are refused before anything moves', async () => {
    const { svc, apply } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, { quantity: 3, rows: [GOOD_RESTOCK, DAMAGED_HOLD] }),
      ],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_INSPECTION_QUANTITY_MISMATCH' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('one undecided unit on a split line blocks the whole finalize', async () => {
    const { svc, apply } = makeService({
      items: [
        item('si-1', RtoDisposition.INSPECT_LATER, {
          quantity: 2,
          rows: [GOOD_RESTOCK, { ...DAMAGED_HOLD, disposition: RtoDisposition.INSPECT_LATER }],
        }),
      ],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_DISPOSITION_UNDECIDED' },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('an unsplit kept-aside line moves its units IN_STOCK at the DAMAGED bin; a split line leaves the unit ledger alone', async () => {
    const { svc, advanceUnits } = makeService({
      items: [
        item('si-1', RtoDisposition.HOLD_DAMAGED, {
          ...noHint,
          rtoCondition: RtoItemCondition.DAMAGED,
        }),
        item('si-2', RtoDisposition.RESTOCK, {
          ...noHint,
          variantId: 'v-si-2',
          quantity: 2,
          rows: [GOOD_RESTOCK, DAMAGED_WRITE_OFF],
        }),
      ],
      leftMovements: [
        packConfirm('m-1', { qty: 2 }),
        packConfirm('m-2', { orderItemId: 'oi-si-2', variantId: 'v-si-2', qty: 2 }),
      ],
    });
    await svc.finalize(SHIP, STAFF);
    expect(advanceUnits).toHaveBeenCalledTimes(1);
    expect((advanceUnits.mock.calls[0] as unknown[])[1]).toMatchObject({
      shipmentItemId: 'si-1',
      toStatus: 'IN_STOCK',
      gate: 'RTO_HOLD_DAMAGED',
      binId: 'bin-damaged',
    });
  });
});

describe('RtoDispositionService.finalize — guards', () => {
  it('refuses while any item is still marked for later inspection', async () => {
    // The whole point of the disposition. Finalizing around it would
    // force the guess the operator declined to make at the bench, and
    // WMS-8 moves real stock — a wrong restock sells a broken item, a
    // wrong write-off destroys a good one. The goods are safe in the
    // meantime: RTO_HOLD is outside every availability sum (BIN-2).
    const { svc, runWithRetry, transitionStatus } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK), item('si-2', RtoDisposition.INSPECT_LATER)],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_DISPOSITION_UNDECIDED' },
    });
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('RTO_INSPECTION_INCOMPLETE when any item lacks inspection', async () => {
    const { svc, runWithRetry, transitionStatus } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK), item('si-2', null, { rtoCondition: null })],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_INSPECTION_INCOMPLETE' },
    });
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('ORDER_NOT_RTO_READY when order is not RTO_RECEIVED', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.PACKED });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_RTO_READY' },
    });
  });

  it('RTO_RESTOCK_NEVER_LEFT_STOCK when a RESTOCK line has no hint AND no pack movement', async () => {
    // Seeded / imported data (SH-TEST-523902): the unit never left our
    // stock through Skydrop, so restocking it would add stock that was
    // never taken out. The message says so, and says what to do.
    const { svc, runWithRetry, transitionStatus } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, { pickedBin: null, pickedBatch: null })],
    });
    const err = await svc.finalize(SHIP, STAFF).catch((e: unknown) => e);
    expect(err).toMatchObject({ response: { code: 'RTO_RESTOCK_NEVER_LEFT_STOCK' } });
    const message = (err as { response: { message: string } }).response.message;
    expect(message).toMatch(/never left our stock/);
    expect(message).toMatch(/Write off/);
    expect(message).toContain('SKU-si-1');
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('WRITE_OFF item with no pickedBin/Batch is fine (no movement needed)', async () => {
    const { svc } = makeService({
      items: [item('si-1', RtoDisposition.WRITE_OFF, { pickedBin: null })],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(r.writtenOffCount).toBe(1);
  });

  it('RTO_NO_ITEMS when shipment has zero items', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        originWarehouseId: WH,
        orderShipments: [{ orderId: ORDER }],
        items: [],
      },
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_NO_ITEMS' },
    });
  });

  it('404 when shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 when order is missing', async () => {
    const { svc } = makeService({ orderStatus: 'missing' });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── R6: cross-warehouse restock guard (conservation-critical) ─────────

  it('R6: rtoReceivedWarehouseId === origin behaves exactly as before (restock proceeds at origin)', async () => {
    const { svc, apply } = makeService({ rtoReceivedWarehouseId: WH });
    const r = await svc.finalize(SHIP, STAFF);
    expect(r.restockedCount).toBe(1);
    expect(apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ warehouseId: WH }),
    );
  });

  // R6b REPLACED R6's blanket refusal: a cross-warehouse return is now
  // restocked WHERE IT LANDED, into a lineage-preserving child batch. The
  // conservation property R6 protected still holds — the credit goes to
  // the receiving warehouse, never to the origin bin that does not hold
  // the goods.
  it('R6b: RESTOCK at a DIFFERENT warehouse credits the RECEIVING warehouse, not origin', async () => {
    const { svc, apply, transitionStatus, resolveTarget } = makeService({
      rtoReceivedWarehouseId: 'wh-other',
      items: [item('si-1', RtoDisposition.RESTOCK)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(r.restockedCount).toBe(1);
    expect(transitionStatus).toHaveBeenCalled();

    // The target resolver was asked, with both warehouses in hand.
    expect(resolveTarget.mock.calls[0]![1]).toMatchObject({
      originWarehouseId: WH,
      receivedWarehouseId: 'wh-other',
    });
    // ...and the movement landed at the receiving warehouse.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1]).toMatchObject({
      warehouseId: 'wh-other',
      type: 'RETURN_RESTOCK',
    });
  });

  it('R6b: a cross-warehouse restock is audited as such', async () => {
    const { svc, auditLog } = makeService({
      rtoReceivedWarehouseId: 'wh-other',
      items: [item('si-1', RtoDisposition.RESTOCK)],
    });
    await svc.finalize(SHIP, STAFF);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rto.finalized',
        metadata: expect.objectContaining({
          crossWarehouseRestock: true,
          restockWarehouseId: 'wh-other',
          originWarehouseId: WH,
        }),
      }),
    );
  });

  it('R6b: a same-warehouse restock is NOT flagged as cross-warehouse', async () => {
    const { svc, auditLog, apply } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK)],
    });
    await svc.finalize(SHIP, STAFF);
    expect(apply.mock.calls[0]![1]).toMatchObject({ warehouseId: WH });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ crossWarehouseRestock: false }),
      }),
    );
  });

  it('R6: WRITE_OFF-only finalize is still allowed cross-warehouse (emits no movement)', async () => {
    const { svc, apply, transitionStatus } = makeService({
      rtoReceivedWarehouseId: 'wh-other',
      items: [item('si-1', RtoDisposition.WRITE_OFF)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(r.writtenOffCount).toBe(1);
    expect(r.restockedCount).toBe(0);
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).toHaveBeenCalled();
  });

  it('R6b: a cross-warehouse restock of a batch-picked line still goes through the target resolver', async () => {
    const { svc, apply, resolveTarget } = makeService({
      rtoReceivedWarehouseId: 'wh-other',
      items: [item('si-1', RtoDisposition.RESTOCK, { pickedBin: null, pickedBatch: null })],
      leftMovements: [packConfirm('m-1')],
    });
    await svc.finalize(SHIP, STAFF);
    expect(resolveTarget.mock.calls[0]![1]).toMatchObject({
      originWarehouseId: WH,
      receivedWarehouseId: 'wh-other',
      pickedBinId: 'mv-bin',
      pickedBatchId: 'mv-bat',
      quantity: 2,
    });
    expect(apply.mock.calls[0]![1]).toMatchObject({ warehouseId: 'wh-other' });
  });

  it('R6b: a MIXED cross-warehouse batch restocks one line and writes off the other', async () => {
    const { svc, apply } = makeService({
      rtoReceivedWarehouseId: 'wh-other',
      items: [item('si-1', RtoDisposition.WRITE_OFF), item('si-2', RtoDisposition.RESTOCK)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(r).toMatchObject({ restockedCount: 1, writtenOffCount: 1 });
    // Only the RESTOCK line moves stock; the write-off's dispatch
    // decrement stands (Model A).
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

// ── WMS-8e: booked into the returns hold at receive, moved at finalize ────

/** A RETURN_RECEIVE booking for a line (what receive wrote into the hold). */
function heldBooking(
  opts: { line?: string; qty?: number; batch?: string; leftFrom?: string } = {},
): AnyArgs {
  return {
    warehouseId: WH,
    binId: 'bin-hold',
    batchId: opts.batch ?? 'bat-held',
    qtyChange: opts.qty ?? 2,
    metadata: {
      shipmentItemId: opts.line ?? 'si-1',
      leftFromWarehouseId: WH,
      leftFromBinId: opts.leftFrom ?? 'shelf-1',
      leftFromBatchId: opts.batch ?? 'bat-held',
    },
  };
}

describe('RtoDispositionService.finalize — a line BOOKED into the returns hold (WMS-8e)', () => {
  const GOOD_RESTOCK = {
    quantity: 1,
    condition: RtoItemCondition.GOOD,
    disposition: RtoDisposition.RESTOCK,
  };
  const DAMAGED_HOLD = {
    quantity: 1,
    condition: RtoItemCondition.DAMAGED,
    disposition: RtoDisposition.HOLD_DAMAGED,
  };

  it('RESTOCK: a paired TRANSFER hold → sellable destination, same batch — no RETURN_RESTOCK', async () => {
    const {
      svc,
      apply,
      resolveTarget,
      sellableDestination,
      transitionStatus,
      stockMovementFindMany,
    } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK)],
      heldMovements: [heldBooking()],
    });
    const r = await svc.finalize(SHIP, STAFF);

    const moves = apply.mock.calls.map((c) => c[1]);
    expect(moves).toEqual([
      expect.objectContaining({
        type: StockMovementType.TRANSFER_OUT,
        binId: 'bin-hold',
        batchId: 'bat-held',
        qtyChange: -2,
        fromBinId: 'bin-hold',
        toBinId: 'bin-floor',
        shipmentId: SHIP,
        orderId: ORDER,
      }),
      expect.objectContaining({
        type: StockMovementType.TRANSFER_IN,
        binId: 'bin-floor',
        batchId: 'bat-held',
        qtyChange: 2,
      }),
    ]);
    // The pair shares one transfer group.
    expect(moves[0]!['transferGroupId']).toBe(moves[1]!['transferGroupId']);
    // Where it left from first, then the pick hint.
    expect((sellableDestination.mock.calls[0] as unknown[])[1]).toEqual({
      warehouseId: WH,
      candidateBinIds: ['shelf-1', 'bin-1'],
    });
    // A booked line never goes through the unbooked-line path.
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(packEvidenceCalls(stockMovementFindMany)).toEqual([]);
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    // The row reports the movement that landed it.
    expect(r.items[0]?.movementIds).toEqual(['mv-2']);
  });

  it('1 RESTOCK + 1 HOLD_DAMAGED: one unit to the sellable bin, one to the DAMAGED bin', async () => {
    const { svc, apply } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, {
          quantity: 2,
          rows: [GOOD_RESTOCK, DAMAGED_HOLD],
        }),
      ],
      heldMovements: [heldBooking()],
    });
    const r = await svc.finalize(SHIP, STAFF);
    const moves = apply.mock.calls.map((c) => [c[1]['type'], c[1]['binId'], c[1]['qtyChange']]);
    expect(moves).toEqual([
      [StockMovementType.TRANSFER_OUT, 'bin-hold', -1],
      [StockMovementType.TRANSFER_IN, 'bin-floor', 1],
      [StockMovementType.TRANSFER_OUT, 'bin-hold', -1],
      [StockMovementType.TRANSFER_IN, 'bin-damaged', 1],
    ]);
    expect(r).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      restockedUnits: 1,
      heldDamagedUnits: 1,
    });
  });

  it('WRITE_OFF: an ADJUSTMENT_DECREASE out of the hold (INV-7 reason), freight still charged once', async () => {
    const { svc, apply, transitionStatus, debitForWrittenOffItems } = makeService({
      items: [item('si-1', RtoDisposition.WRITE_OFF, { rtoCondition: RtoItemCondition.DAMAGED })],
      heldMovements: [heldBooking()],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1]).toMatchObject({
      type: StockMovementType.ADJUSTMENT_DECREASE,
      binId: 'bin-hold',
      batchId: 'bat-held',
      qtyChange: -2,
      reasonCode: StockMovementReasonCode.DAMAGED_IN_WAREHOUSE,
      shipmentId: SHIP,
    });
    expect(debitForWrittenOffItems).toHaveBeenCalledTimes(1);
    expect(debitForWrittenOffItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lines: [{ shipmentItemId: 'si-1', quantity: 2 }] }),
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_DAMAGED }),
    );
    expect(r.items[0]?.movementIds).toEqual(['mv-1']);
  });

  it('a MISSING unit written off leaves the hold as LOST', async () => {
    const { svc, apply } = makeService({
      items: [item('si-1', RtoDisposition.WRITE_OFF, { rtoCondition: RtoItemCondition.MISSING })],
      heldMovements: [heldBooking()],
    });
    await svc.finalize(SHIP, STAFF);
    expect(apply.mock.calls[0]![1]).toMatchObject({
      reasonCode: StockMovementReasonCode.LOST,
    });
  });

  it('more coming back than was booked → RTO_RESTOCK_EXCEEDS_STOCK_LEFT, nothing moved', async () => {
    const { svc, apply, transitionStatus } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, { quantity: 2 })],
      heldMovements: [heldBooking({ qty: 1 })],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_EXCEEDS_STOCK_LEFT' },
    });
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('no DAMAGED bin for a booked kept-aside unit ⇒ RTO_NO_DAMAGED_BIN, no transition', async () => {
    const { svc, transitionStatus } = makeService({
      noDamagedBin: true,
      items: [
        item('si-1', RtoDisposition.HOLD_DAMAGED, { rtoCondition: RtoItemCondition.DAMAGED }),
      ],
      heldMovements: [heldBooking()],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_NO_DAMAGED_BIN' },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('gate 2: a finalize movement already on the ledger ⇒ nothing re-applied, transition still runs', async () => {
    const { svc, apply, runWithRetry, transitionStatus, stockMovementFindFirst } = makeService({
      existingMovement: { id: 'mv-prior' },
      items: [item('si-1', RtoDisposition.RESTOCK)],
      heldMovements: [heldBooking()],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).toHaveBeenCalled();
    expect(r.movementsAlreadyApplied).toBe(true);
    // The gate looks for EVERY type a finalize writes.
    expect(stockMovementFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shipmentId: SHIP,
          type: {
            in: [
              StockMovementType.RETURN_RESTOCK,
              StockMovementType.TRANSFER_OUT,
              StockMovementType.ADJUSTMENT_DECREASE,
            ],
          },
        },
      }),
    );
  });

  it('a booked line and an unbooked line finalize together, in ONE movement transaction', async () => {
    const { svc, apply, runWithRetry, resolveTarget } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK),
        // si-2 was not booked (nothing in hold for it) but left through us.
        item('si-2', RtoDisposition.RESTOCK, { pickedBin: null, pickedBatch: null }),
      ],
      heldMovements: [heldBooking({ line: 'si-1' })],
      leftMovements: [packConfirm('m-2', { orderItemId: 'oi-si-2', variantId: 'v-si-2' })],
    });
    await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).toHaveBeenCalledTimes(1);
    const types = apply.mock.calls.map((c) => c[1]['type']);
    expect(types.sort()).toEqual(
      [
        StockMovementType.RETURN_RESTOCK,
        StockMovementType.TRANSFER_IN,
        StockMovementType.TRANSFER_OUT,
      ].sort(),
    );
    expect(resolveTarget).toHaveBeenCalledTimes(1);
    expect(resolveTarget.mock.calls[0]![1]).toMatchObject({ pickedBinId: 'mv-bin' });
  });

  it('the unit ledger follows: a booked unit is moved from IN_STOCK (at the hold) to its new bin', async () => {
    const { svc, advanceUnits } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK)],
      heldMovements: [heldBooking()],
    });
    await svc.finalize(SHIP, STAFF);
    expect((advanceUnits.mock.calls[0] as unknown[])[1]).toMatchObject({
      shipmentItemId: 'si-1',
      fromStatus: 'IN_STOCK',
      toStatus: 'IN_STOCK',
      gate: 'RTO_RESTOCK',
      binId: 'bin-floor',
      batchId: 'bat-held',
    });
  });

  it('an unbooked line’s units still move from RTO_RECEIVED', async () => {
    const { svc, advanceUnits } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK)],
    });
    await svc.finalize(SHIP, STAFF);
    expect((advanceUnits.mock.calls[0] as unknown[])[1]).toMatchObject({
      fromStatus: 'RTO_RECEIVED',
    });
  });
});
