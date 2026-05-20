import { PackQueueService } from '../../src/modules/warehouse-pack/services/pack-queue.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    queue?: string[];
    orderIdForShipment?: (id: string) => string | null;
    order?: AnyArgs | null;
  } = {},
) {
  const queue = [...(opts.queue ?? [])];
  const queryRawUnsafe = jest.fn<Promise<Array<{ id: string }>>, [string]>(
    async () => {
      const id = queue.shift();
      return id === undefined ? [] : [{ id }];
    },
  );
  const shipmentFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async (args) => {
      const id = (args.where as { id: string }).id;
      const oid = opts.orderIdForShipment
        ? opts.orderIdForShipment(id)
        : `o-${id}`;
      return {
        id,
        shipmentNumber: `SH-${id}`,
        pickCompletedAt: new Date('2026-05-19T10:00:00Z'),
        orderShipments: oid === null ? [] : [{ orderId: oid }],
        items: [
          {
            id: `si-${id}`,
            orderItemId: `oi-${id}`,
            skuCode: 'SKU',
            productName: 'P',
            variantLabel: null,
            quantity: 2,
            unitWeightGrams: 100,
            pickedBinId: 'bin-1',
            pickedBatchId: 'bat-1',
          },
        ],
      };
    },
  );
  const txClient = {
    $queryRawUnsafe: queryRawUnsafe,
    shipment: { findUnique: shipmentFindUnique },
  };
  const client = {} as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn(txClient);

  const getById = jest.fn(async () =>
    opts.order === undefined ? { orderId: 'resolved' } : opts.order,
  );
  const orders = { getById };

  const svc = new PackQueueService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
  );
  return { svc, queryRawUnsafe, shipmentFindUnique, getById };
}

describe('PackQueueService.pullNext', () => {
  it('returns null (QUEUE_EMPTY) when no parcel is pack-eligible', async () => {
    const { svc, shipmentFindUnique, getById } = makeService({ queue: [] });
    expect(await svc.pullNext('staff-1')).toBeNull();
    expect(shipmentFindUnique).not.toHaveBeenCalled();
    expect(getById).not.toHaveBeenCalled();
  });

  it('FIFO eligible (PICKED + CREATED + pack_completed_at NULL) + enriches', async () => {
    const { svc, queryRawUnsafe, getById } = makeService({
      queue: ['s1'],
      order: { orderId: 'o1', recipient: { name: 'Asha' } },
      orderIdForShipment: () => 'o1',
    });
    const r = await svc.pullNext('staff-1');
    expect(r).not.toBeNull();
    const sql = queryRawUnsafe.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('FOR UPDATE OF s SKIP LOCKED');
    expect(sql).toContain('ORDER BY s.created_at ASC');
    expect(sql).toContain("s.status = 'created'");
    expect(sql).toContain('s.pack_completed_at IS NULL');
    expect(sql).toContain("o.status = 'picked'");
    expect(getById).toHaveBeenCalledWith('o1');
    expect(r).toMatchObject({
      shipmentId: 's1',
      shipmentNumber: 'SH-s1',
      orderId: 'o1',
      order: { orderId: 'o1' },
    });
    expect(r?.items[0]).toMatchObject({
      shipmentItemId: 'si-s1',
      pickedBinId: 'bin-1',
      pickedBatchId: 'bat-1',
    });
  });

  it('concurrent pulls on a 2-parcel queue: distinct parcels (SKIP LOCKED)', async () => {
    const { svc } = makeService({ queue: ['s1', 's2'] });
    const [a, b] = await Promise.all([
      svc.pullNext('staff-1'),
      svc.pullNext('staff-2'),
    ]);
    const ids = [a?.shipmentId, b?.shipmentId].sort();
    expect(ids).toEqual(['s1', 's2']);
  });

  it('handles a missing OrderShipment junction (orderId "", no getById)', async () => {
    const { svc, getById } = makeService({
      queue: ['s1'],
      orderIdForShipment: () => null,
    });
    const r = await svc.pullNext('staff-1');
    expect(getById).not.toHaveBeenCalled();
    expect(r).toMatchObject({ orderId: '', order: null });
  });
});
