import { InventoryMode } from '@skydrop/db';
import { PackQueueService } from '../../src/modules/warehouse-pack/services/pack-queue.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    queue?: string[];
    orderIdForShipment?: (id: string) => string | null;
    order?: AnyArgs | null;
    /** R4 — effective mode the resolver reports for `v-1`. */
    mode?: InventoryMode;
    /** R4 — resolver blows up (settings outage). */
    modeThrows?: boolean;
  } = {},
) {
  const queue = [...(opts.queue ?? [])];
  const queryRawUnsafe = jest.fn<Promise<Array<{ id: string }>>, [string, ...unknown[]]>(
    async () => {
      const id = queue.shift();
      return id === undefined ? [] : [{ id }];
    },
  );
  const shipmentFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async (args) => {
    const id = (args.where as { id: string }).id;
    const oid = opts.orderIdForShipment ? opts.orderIdForShipment(id) : `o-${id}`;
    return {
      id,
      shipmentNumber: `SH-${id}`,
      courierCode: 'delhivery',
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
          orderItem: { variantId: 'v-1', order: { sellerId: 'seller-1' } },
        },
      ],
    };
  });
  const txClient = {
    $queryRawUnsafe: queryRawUnsafe,
    shipment: { findUnique: shipmentFindUnique },
  };
  const client = {} as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const getById = jest.fn(async () =>
    opts.order === undefined ? { orderId: 'resolved' } : opts.order,
  );
  const orders = { getById };

  const resolveForVariants = jest.fn(async (_sellerId: string, ids: readonly string[]) => {
    if (opts.modeThrows) throw new Error('settings down');
    return new Map(ids.map((id) => [id, opts.mode ?? InventoryMode.NORMAL]));
  });
  const modes = { resolveForVariants };

  const svc = new PackQueueService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    modes as unknown as InventoryModeService,
  );
  return { svc, queryRawUnsafe, shipmentFindUnique, getById, resolveForVariants };
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
    const [a, b] = await Promise.all([svc.pullNext('staff-1'), svc.pullNext('staff-2')]);
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

  it('includes courierCode in the pulled parcel', async () => {
    const { svc } = makeService({ queue: ['s1'], orderIdForShipment: () => 'o1' });
    const r = await svc.pullNext('staff-1');
    expect(r).toMatchObject({ courierCode: 'delhivery' });
  });

  it('with no courierCode filter: SQL omits the courier clause and passes no extra params', async () => {
    const { svc, queryRawUnsafe } = makeService({ queue: ['s1'], orderIdForShipment: () => 'o1' });
    await svc.pullNext('staff-1');
    const call = queryRawUnsafe.mock.calls[0]!;
    expect(call[0]).not.toContain('s.courier_code');
    expect(call.length).toBe(1);
  });

  it('with a courierCode filter: SQL includes the bound courier clause', async () => {
    const { svc, queryRawUnsafe } = makeService({ queue: ['s1'], orderIdForShipment: () => 'o1' });
    await svc.pullNext('staff-1', undefined, 'delhivery');
    const call = queryRawUnsafe.mock.calls[0]!;
    expect(call[0]).toContain('AND s.courier_code = $1');
    expect(call.slice(1)).toEqual(['delhivery']);
  });
});

describe('PackQueueService.pullNext — R4 inventory mode', () => {
  it('reports STRICT on the line so the packer screen can offer a scan field', async () => {
    const { svc, resolveForVariants } = makeService({
      queue: ['s-1'],
      mode: InventoryMode.STRICT,
    });
    const pulled = await svc.pullNext('staff-1');
    expect(pulled?.items[0]?.variantId).toBe('v-1');
    expect(pulled?.items[0]?.inventoryMode).toBe(InventoryMode.STRICT);
    // Batched once for the whole parcel, never per line.
    expect(resolveForVariants).toHaveBeenCalledTimes(1);
    expect(resolveForVariants).toHaveBeenCalledWith('seller-1', ['v-1']);
  });

  it('FAILS OPEN to NORMAL when the resolver throws — a settings outage must not stall the pack bench', async () => {
    const { svc } = makeService({ queue: ['s-1'], modeThrows: true });
    const pulled = await svc.pullNext('staff-1');
    expect(pulled?.items[0]?.inventoryMode).toBe(InventoryMode.NORMAL);
  });
});
