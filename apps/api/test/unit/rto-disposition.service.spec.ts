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
  const apply = jest.fn(async () => {
    movementCounter += 1;
    return {
      movementId: `mv-${movementCounter}`,
      stockLevelId: 'sl-1',
      qtyBefore: 0,
      qtyAfter: 1,
      version: 1,
    };
  });
  const runWithRetry = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({}),
  );
  const mutation = { apply, runWithRetry };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  const svc = new RtoDispositionService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    mutation as unknown as StockMutationService,
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
    auditLog,
  };
}

describe('RtoDispositionService.finalize — retry-state matrix', () => {
  it('STATE 1 (neither done): applies movements then transitions', async () => {
    const { svc, runWithRetry, apply, transitionStatus, auditLog } =
      makeService({
        items: [item('si-1', RtoDisposition.RESTOCK, { quantity: 3 })],
      });
    const r = await svc.finalize(SHIP, STAFF);

    expect(runWithRetry).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: StockMovementType.RETURN_RESTOCK,
        qtyChange: 3,
        binId: 'bin-1',
        batchId: 'bat-1',
        sellerId: SELLER,
        warehouseId: WH,
        actorType: ActorType.STAFF,
        actorId: STAFF,
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
      shipmentId: SHIP,
      orderId: ORDER,
      status: OrderStatus.RTO_RESTOCKED,
      restockedCount: 1,
      writtenOffCount: 0,
      movementsAlreadyApplied: false,
      alreadyFinalized: false,
    });
    expect(r.items[0]).toMatchObject({
      shipmentItemId: 'si-1',
      disposition: RtoDisposition.RESTOCK,
      movementId: 'mv-1',
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rto.finalized' }),
    );
  });

  it('STATE 2 (movements done, transition pending): gate-2 skips re-apply, transition runs', async () => {
    const { svc, runWithRetry, apply, transitionStatus } = makeService({
      existingMovement: { id: 'mv-prior' }, // gate 2 fires
      items: [item('si-1', RtoDisposition.RESTOCK)],
    });
    const r = await svc.finalize(SHIP, STAFF);
    // Movement loop completely skipped → no double-restock.
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    // Transition still runs to complete the retry.
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    expect(r).toMatchObject({
      status: OrderStatus.RTO_RESTOCKED,
      movementsAlreadyApplied: true,
      alreadyFinalized: false,
    });
    expect(r.items[0]?.movementId).toBeNull(); // not applied this call
  });

  it('STATE 3 (both done): alreadyFinalized short-circuit', async () => {
    const { svc, stockMovementFindFirst, runWithRetry, apply, transitionStatus } =
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
    });
    // No further work past pre-flight.
    expect(stockMovementFindFirst).not.toHaveBeenCalled();
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});

describe('RtoDispositionService.finalize — disposition mixes', () => {
  it('all-WRITE_OFF: no movements, transition still runs', async () => {
    const { svc, runWithRetry, apply, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.WRITE_OFF),
        item('si-2', RtoDisposition.WRITE_OFF),
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).not.toHaveBeenCalled(); // empty restock set
    expect(apply).not.toHaveBeenCalled();
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ to: OrderStatus.RTO_RESTOCKED }),
    );
    expect(r.restockedCount).toBe(0);
    expect(r.writtenOffCount).toBe(2);
    expect(r.movementsAlreadyApplied).toBe(false); // no movements existed; loop also skipped
    expect(r.items.every((i) => i.movementId === null)).toBe(true);
  });

  it('mixed RESTOCK + WRITE_OFF: only RESTOCK gets a movement', async () => {
    const { svc, runWithRetry, apply } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, { quantity: 2 }),
        item('si-2', RtoDisposition.WRITE_OFF, { quantity: 3 }),
        item('si-3', RtoDisposition.RESTOCK, { quantity: 1 }),
      ],
    });
    const r = await svc.finalize(SHIP, STAFF);
    expect(runWithRetry).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(r.restockedCount).toBe(2);
    expect(r.writtenOffCount).toBe(1);
    const movementIds = r.items.map((i) => i.movementId);
    expect(movementIds.filter((m) => m !== null)).toHaveLength(2);
    expect(
      r.items.find((i) => i.shipmentItemId === 'si-2')?.movementId,
    ).toBeNull();
  });
});

describe('RtoDispositionService.finalize — guards', () => {
  it('RTO_INSPECTION_INCOMPLETE when any item lacks inspection', async () => {
    const { svc, runWithRetry, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK),
        item('si-2', null, { rtoCondition: null }), // uninspected
      ],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_INSPECTION_INCOMPLETE' },
    });
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('ORDER_NOT_RTO_READY when order is not RTO_RECEIVED (and not RTO_RESTOCKED)', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.PACKED });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_RTO_READY' },
    });
  });

  it('RTO_RESTOCK_MISSING_CONTEXT when a RESTOCK item has no pickedBin/Batch', async () => {
    const { svc, runWithRetry, transitionStatus } = makeService({
      items: [
        item('si-1', RtoDisposition.RESTOCK, { pickedBin: null }),
      ],
    });
    await expect(svc.finalize(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'RTO_RESTOCK_MISSING_CONTEXT' },
    });
    expect(runWithRetry).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
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

