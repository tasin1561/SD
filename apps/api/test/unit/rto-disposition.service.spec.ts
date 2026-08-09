import { NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  RtoDisposition,
  RtoItemCondition,
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
  } = {},
): AnyArgs {
  return {
    id,
    orderItemId: `oi-${id}`,
    quantity: opts.quantity ?? 2,
    rtoCondition: opts.rtoCondition === undefined ? RtoItemCondition.GOOD : opts.rtoCondition,
    rtoDisposition: disposition,
    pickedBinId: opts.pickedBin === undefined ? 'bin-1' : opts.pickedBin,
    pickedBatchId: opts.pickedBatch === undefined ? 'bat-1' : opts.pickedBatch,
    orderItem: {
      id: `oi-${id}`,
      variantId: opts.variantId ?? `v-${id}`,
      order: { sellerId: SELLER },
    },
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
  const client = {
    shipment: { findFirst: shipmentFindFirst },
    stockMovement: { findFirst: stockMovementFindFirst },
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
  const restockTargets = { resolve: resolveTarget };
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
    transitionStatus,
    apply,
    runWithRetry,
    auditLog,
    resolveTarget,
    debitForWrittenOffItems,
  };
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

describe('RtoDispositionService.finalize — guards', () => {
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

  it('RTO_RESTOCK_MISSING_CONTEXT when a RESTOCK item has no pickedBin/Batch', async () => {
    const { svc, runWithRetry } = makeService({
      items: [item('si-1', RtoDisposition.RESTOCK, { pickedBin: null })],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_MISSING_CONTEXT' },
    });
    expect(runWithRetry).not.toHaveBeenCalled();
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
