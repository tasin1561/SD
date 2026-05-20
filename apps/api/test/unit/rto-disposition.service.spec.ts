import { NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  ReservationReleaseReason,
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
import type { StockReservationService } from '../../src/modules/inventory-stock/services/stock-reservation.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

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
    rtoCondition:
      opts.rtoCondition === undefined
        ? RtoItemCondition.GOOD
        : opts.rtoCondition,
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
    activeReservations?: Array<{ id: string; orderItemId: string; qtyReserved: number }>;
    /** Per-reservation release outcome. Indexed by reservation id;
     *  missing → defaults to {alreadyInactive:false}. */
    releaseOutcomes?: Record<string, { alreadyInactive: boolean }>;
  } = {},
) {
  const defaultItems = opts.items ?? [item('si-1', RtoDisposition.RESTOCK)];
  const defaultShipment = {
    id: SHIP,
    originWarehouseId: WH,
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
    return {
      movementId: `mv-${movementCounter}`,
      stockLevelId: 'sl-1',
      qtyBefore: 10,
      qtyAfter: 8,
      version: 1,
    };
  });
  const runWithRetry = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({}),
  );
  const mutation = { apply, runWithRetry };

  const listActiveForOrder = jest.fn(async () => opts.activeReservations ?? []);
  const release = jest.fn(async (id: string) => {
    const outcome = opts.releaseOutcomes?.[id] ?? { alreadyInactive: false };
    return {
      reservationId: id,
      qtyReleased: outcome.alreadyInactive ? 0 : 1,
      status: 'RELEASED',
      alreadyInactive: outcome.alreadyInactive,
    };
  });
  const reservations = { listActiveForOrder, release };

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  const svc = new RtoDispositionService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    mutation as unknown as StockMutationService,
    reservations as unknown as StockReservationService,
    audit as unknown as AuditLogService,
  );
  return {
    svc,
    shipmentFindFirst,
    stockMovementFindFirst,
    getById,
    transitionStatus,
    apply,
    runWithRetry,
    listActiveForOrder,
    release,
    auditLog,
  };
}

describe('RtoDispositionService.finalize — retry-state matrix', () => {
  it('STATE 1 (neither done) RESTOCK: release() reservations, NO movement, transition', async () => {
    const { svc, runWithRetry, apply, release, transitionStatus, auditLog } =
      makeService({
        items: [item('si-1', RtoDisposition.RESTOCK, { quantity: 3 })],
        activeReservations: [
          { id: 'r1', orderItemId: 'oi-si-1', qtyReserved: 3 },
        ],
      });
    const r = await svc.finalize(SHIP, STAFF);

    // Release was called per active reservation — no movement.
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(
      'r1',
      ReservationReleaseReason.OTHER,
      expect.objectContaining({ type: ActorType.STAFF }),
    );
    expect(runWithRetry).not.toHaveBeenCalled(); // no WRITE_OFF movements
    expect(apply).not.toHaveBeenCalled();

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
      reservationsReleased: 1,
    });
    expect(r.items[0]?.movementId).toBeNull();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rto.finalized' }),
    );
  });

  it('STATE 1 (neither done) WRITE_OFF: release + ADJUSTMENT_DECREASE -qty + transition', async () => {
    const { svc, release, apply, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.WRITE_OFF, {
          quantity: 2,
          rtoCondition: RtoItemCondition.DAMAGED,
        }),
      ],
      activeReservations: [
        { id: 'r1', orderItemId: 'oi-si-1', qtyReserved: 2 },
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(release).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: StockMovementType.ADJUSTMENT_DECREASE,
        qtyChange: -2,
        reasonCode: StockMovementReasonCode.DAMAGED_IN_WAREHOUSE,
        binId: 'bin-1',
        batchId: 'bat-1',
        actorType: ActorType.STAFF,
        actorId: STAFF,
        orderId: ORDER,
        shipmentId: SHIP,
      }),
    );

    // Release BEFORE movement BEFORE transition.
    const relOrd = release.mock.invocationCallOrder[0] ?? 0;
    const movOrd = apply.mock.invocationCallOrder[0] ?? 0;
    const transOrd = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(relOrd).toBeLessThan(movOrd);
    expect(movOrd).toBeLessThan(transOrd);

    expect(r).toMatchObject({
      restockedCount: 0,
      writtenOffCount: 1,
      reservationsReleased: 1,
    });
    expect(r.items[0]?.movementId).toBe('mv-1');
  });

  it('STATE 2 (movements done, transition pending): gate-2 skips re-apply, releases run, transition runs', async () => {
    const { svc, runWithRetry, apply, release, transitionStatus } = makeService({
      existingMovement: { id: 'mv-prior' }, // gate 2 keyed on ADJUSTMENT_DECREASE
      items: [item('si-1', RtoDisposition.WRITE_OFF)],
      activeReservations: [
        { id: 'r1', orderItemId: 'oi-si-1', qtyReserved: 2 },
      ],
      releaseOutcomes: { r1: { alreadyInactive: true } }, // already released in prior call too
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(release).toHaveBeenCalled(); // attempted, but idempotent
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    expect(r).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      movementsAlreadyApplied: true,
      alreadyFinalized: false,
      reservationsReleased: 0, // all already-released
    });
  });

  it('STATE 3 (both done): alreadyFinalized short-circuit, no releases', async () => {
    const { svc, stockMovementFindFirst, runWithRetry, apply, release, transitionStatus } =
      makeService({
        orderStatus: OrderStatus.RTO_RESTOCKED,
        items: [
          item('si-1', RtoDisposition.RESTOCK),
          item('si-2', RtoDisposition.WRITE_OFF),
        ],
      });
    const r = await svc.finalize(SHIP, STAFF);
    expect(r).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      restockedCount: 1,
      writtenOffCount: 1,
      movementsAlreadyApplied: true,
      alreadyFinalized: true,
      reservationsReleased: 0,
    });
    expect(stockMovementFindFirst).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});

describe('RtoDispositionService.finalize — disposition mixes', () => {
  it('all-RESTOCK with NO active reservations (already released): no movement, transition runs', async () => {
    const { svc, runWithRetry, apply, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK),
        item('si-2', RtoDisposition.RESTOCK),
      ],
      activeReservations: [], // all reservations already gone (e.g., released elsewhere)
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    expect(r.restockedCount).toBe(2);
    expect(r.reservationsReleased).toBe(0);
  });

  it('all-WRITE_OFF: release + ADJUSTMENT_DECREASE per item, transition runs', async () => {
    const { svc, release, apply, runWithRetry } = makeService({
      items: [
        item('si-1', RtoDisposition.WRITE_OFF, {
          quantity: 2,
          rtoCondition: RtoItemCondition.DAMAGED,
        }),
        item('si-2', RtoDisposition.WRITE_OFF, {
          quantity: 3,
          rtoCondition: RtoItemCondition.MISSING,
        }),
      ],
      activeReservations: [
        { id: 'r1', orderItemId: 'oi-si-1', qtyReserved: 2 },
        { id: 'r2', orderItemId: 'oi-si-2', qtyReserved: 3 },
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(release).toHaveBeenCalledTimes(2);
    expect(runWithRetry).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2);
    // DAMAGED → DAMAGED_IN_WAREHOUSE; MISSING → LOST
    const reasonCodes = apply.mock.calls.map(
      (c) => (c[1] as { reasonCode: StockMovementReasonCode }).reasonCode,
    );
    expect(reasonCodes).toEqual(
      expect.arrayContaining([
        StockMovementReasonCode.DAMAGED_IN_WAREHOUSE,
        StockMovementReasonCode.LOST,
      ]),
    );
    expect(r.writtenOffCount).toBe(2);
    expect(r.reservationsReleased).toBe(2);
  });

  it('mixed RESTOCK + WRITE_OFF: ALL reservations released, ONLY WRITE_OFF gets a movement', async () => {
    const { svc, release, runWithRetry, apply } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, { quantity: 2 }),
        item('si-2', RtoDisposition.WRITE_OFF, {
          quantity: 3,
          rtoCondition: RtoItemCondition.DAMAGED,
        }),
        item('si-3', RtoDisposition.RESTOCK, { quantity: 1 }),
      ],
      activeReservations: [
        { id: 'r1', orderItemId: 'oi-si-1', qtyReserved: 2 },
        { id: 'r2', orderItemId: 'oi-si-2', qtyReserved: 3 },
        { id: 'r3', orderItemId: 'oi-si-3', qtyReserved: 1 },
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(release).toHaveBeenCalledTimes(3); // all reservations
    expect(runWithRetry).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1); // only the WRITE_OFF item
    expect(r.restockedCount).toBe(2);
    expect(r.writtenOffCount).toBe(1);
    expect(r.reservationsReleased).toBe(3);
    const movementIds = r.items.map((i) => i.movementId);
    expect(movementIds.filter((m) => m !== null)).toHaveLength(1);
    expect(
      r.items.find((i) => i.shipmentItemId === 'si-2')?.movementId,
    ).toBe('mv-1');
  });

  it('reasonCode mapping: GOOD/null → OTHER (debt-flagged fallback)', async () => {
    const { svc, apply } = makeService({
      items: [
        item('si-1', RtoDisposition.WRITE_OFF, {
          quantity: 1,
          rtoCondition: RtoItemCondition.GOOD,
        }),
      ],
      activeReservations: [
        { id: 'r1', orderItemId: 'oi-si-1', qtyReserved: 1 },
      ],
    });
    await svc.finalize(SHIP, STAFF);
    expect(apply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ reasonCode: StockMovementReasonCode.OTHER }),
    );
  });
});

describe('RtoDispositionService.finalize — guards', () => {
  it('RTO_INSPECTION_INCOMPLETE when any item lacks inspection', async () => {
    const { svc, runWithRetry, release, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK),
        item('si-2', null, { rtoCondition: null }),
      ],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_INSPECTION_INCOMPLETE' },
    });
    expect(release).not.toHaveBeenCalled();
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('ORDER_NOT_RTO_READY when order is not RTO_RECEIVED (and not RTO_RESTOCKED)', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.PACKED });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_RTO_READY' },
    });
  });

  it('RTO_WRITE_OFF_MISSING_CONTEXT when a WRITE_OFF item has no pickedBin/Batch', async () => {
    const { svc, release, runWithRetry } = makeService({
      items: [
        item('si-1', RtoDisposition.WRITE_OFF, { pickedBin: null }),
      ],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_WRITE_OFF_MISSING_CONTEXT' },
    });
    expect(release).not.toHaveBeenCalled();
    expect(runWithRetry).not.toHaveBeenCalled();
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
    await expect(svc.finalize(SHIP, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 when order is missing', async () => {
    const { svc } = makeService({ orderStatus: 'missing' });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
