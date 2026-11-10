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
    /** PACK-4 — `ops.pack_claim_minutes`. */
    claimMinutes?: number;
    /** PACK-4 — rows the release's guarded updateMany matched. */
    releaseCount?: number;
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
  // PACK-4: the claim window is a setting, read before the tx.
  const settingFindUnique = jest.fn(async () => ({ valueInt: opts.claimMinutes ?? 10 }));
  const shipmentUpdateMany = jest.fn(async () => ({ count: opts.releaseCount ?? 1 }));
  const client = {
    systemSetting: { findUnique: settingFindUnique },
    shipment: { updateMany: shipmentUpdateMany },
  } as unknown as {
    systemSetting: { findUnique: jest.Mock };
    shipment: { updateMany: jest.Mock };
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
  return {
    svc,
    queryRawUnsafe,
    shipmentFindUnique,
    getById,
    resolveForVariants,
    settingFindUnique,
    shipmentUpdateMany,
  };
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
    expect(sql).toContain('FOR UPDATE OF s2 SKIP LOCKED');
    expect(sql).toContain('ORDER BY s2.created_at ASC');
    expect(sql).toContain("s2.status = 'created'");
    expect(sql).toContain('s2.pack_completed_at IS NULL');
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
    expect(call[0]).not.toContain('courier_code');
    // $1 the asking packer, $2 the claim window — and nothing else.
    expect(call.slice(1)).toEqual(['staff-1', 10]);
  });

  it('with a courierCode filter: SQL includes the bound courier clause', async () => {
    const { svc, queryRawUnsafe } = makeService({ queue: ['s1'], orderIdForShipment: () => 'o1' });
    await svc.pullNext('staff-1', undefined, 'delhivery');
    const call = queryRawUnsafe.mock.calls[0]!;
    expect(call[0]).toContain('AND s2.courier_code = $3');
    expect(call.slice(1)).toEqual(['staff-1', 10, 'delhivery']);
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

describe('PackQueueService — PACK-4 claim (shape only; the real proof is the e2e)', () => {
  /*
    These assert the STATEMENT, not the behaviour, and that is the most a
    mocked Prisma can honestly do: it has no row locks, no partial unique
    index and no `now()`. The behaviour — two packers, one parcel, one
    winner — is proved in
    `test/e2e/warehouse-pack-concurrency.e2e-spec.ts` against a real
    database. What is worth pinning here is that the claim is written by
    the SAME statement that selects the row, because the day somebody
    splits it into a SELECT and an UPDATE the race comes back and no
    behavioural test on a mock would notice.
  */
  it('claims inside the selecting statement — one UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)', async () => {
    const { svc, queryRawUnsafe } = makeService({ queue: ['s1'], orderIdForShipment: () => 'o1' });
    await svc.pullNext('staff-1');
    const sql = queryRawUnsafe.mock.calls[0]![0];
    expect(sql).toMatch(/^UPDATE shipments s/);
    expect(sql).toContain('SET pack_claimed_by_staff_id = $1::uuid');
    expect(sql).toContain('make_interval(mins => $2::int)');
    expect(sql).toContain('FOR UPDATE OF s2 SKIP LOCKED');
    expect(sql).toContain('RETURNING s.id');
  });

  it('skips a parcel another packer holds — an open box OR a live claim', async () => {
    const { svc, queryRawUnsafe } = makeService({ queue: ['s1'], orderIdForShipment: () => 'o1' });
    await svc.pullNext('staff-1');
    const sql = queryRawUnsafe.mock.calls[0]![0];
    // The box: another packer's, and only while it is still live.
    expect(sql).toContain('FROM pack_boxes pb');
    expect(sql).toContain("pb.status = 'open'");
    expect(sql).toContain('pb.expires_at > now()');
    expect(sql).toContain('pb.packer_staff_id <> $1::uuid');
    // The claim: expiry evaluated INLINE, never by a sweeper, and my own
    // claim never hides my own parcel.
    expect(sql).toContain('s2.pack_claim_expires_at <= now()');
    expect(sql).toContain('s2.pack_claimed_by_staff_id = $1::uuid');
  });

  it('the claim window comes from ops.pack_claim_minutes', async () => {
    const { svc, queryRawUnsafe, settingFindUnique } = makeService({
      queue: ['s1'],
      orderIdForShipment: () => 'o1',
      claimMinutes: 3,
    });
    await svc.pullNext('staff-1');
    expect(settingFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ops.pack_claim_minutes' } }),
    );
    expect(queryRawUnsafe.mock.calls[0]!.slice(1)).toEqual(['staff-1', 3]);
  });

  it('release is guarded on the claim being the asking packer’s', async () => {
    const { svc, shipmentUpdateMany } = makeService();
    const r = await svc.releaseClaim('s1', 'staff-1');
    expect(r.released).toBe(true);
    expect(shipmentUpdateMany).toHaveBeenCalledWith({
      where: { id: 's1', packClaimedByStaffId: 'staff-1' },
      data: { packClaimedByStaffId: null, packClaimExpiresAt: null },
    });
  });

  it('releasing a claim that is not yours moves nothing and is not an error', async () => {
    const { svc } = makeService({ releaseCount: 0 });
    expect(await svc.releaseClaim('s1', 'staff-2')).toEqual({ released: false });
  });
});
