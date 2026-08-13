import { InventoryMode } from '@skydrop/db';
import { PickQueueService } from '../../src/modules/warehouse-pick/services/pick-queue.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PickExpirationService } from '../../src/modules/warehouse-pick/services/pick-expiration.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    /** Ordered shipment ids the SKIP-LOCKED select hands out, one per
     *  locking SELECT (shift() models FOR UPDATE … SKIP LOCKED: each
     *  caller consumes the next unlocked row; consumed rows are
     *  invisible to the others). */
    queue?: string[];
    /** Junction resolution; return null to simulate a missing
     *  OrderShipment row. Default: `o-<shipmentId>`. */
    orderIdForShipment?: (id: string) => string | null;
    /** ops.pick_task_timeout_hours; undefined → no setting row → default
     *  4h. */
    timeoutHours?: number;
    /** getById result; undefined → default {orderId}; null → missing. */
    order?: AnyArgs | null;
    /** R4 — effective mode the resolver reports for `v-1`. */
    mode?: InventoryMode;
    /** R4 — resolver blows up (settings outage). */
    modeThrows?: boolean;
  } = {},
) {
  const queue = [...(opts.queue ?? [])];
  const queryRawUnsafe = jest.fn<Promise<Array<{ id: string }>>, [string]>(async () => {
    const id = queue.shift();
    return id === undefined ? [] : [{ id }];
  });
  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => {
    const id = (args.where as { id: string }).id;
    const oid = opts.orderIdForShipment ? opts.orderIdForShipment(id) : `o-${id}`;
    return {
      id,
      shipmentNumber: `SH-${id}`,
      orderShipments: oid === null ? [] : [{ orderId: oid }],
      items: [
        {
          id: `si-${id}`,
          orderItemId: `oi-${id}`,
          skuCode: 'SKU-1',
          productName: 'Widget',
          variantLabel: null,
          quantity: 2,
          unitWeightGrams: 100,
          orderItem: { variantId: 'v-1', order: { sellerId: 'seller-1' } },
        },
      ],
    };
  });
  const systemSettingFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.timeoutHours === undefined ? null : { valueInt: opts.timeoutHours },
  );

  const txClient = { $queryRawUnsafe: queryRawUnsafe, shipment: { update } };
  const client = {
    systemSetting: { findUnique: systemSettingFindUnique },
  } as {
    systemSetting: { findUnique: typeof systemSettingFindUnique };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const getById = jest.fn(async () =>
    opts.order === undefined ? { orderId: 'resolved' } : opts.order,
  );
  const orders = { getById };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown]>(async () => 'a1');
  const audit = { log: auditLog };
  const scheduleExpiration = jest.fn<Promise<void>, [string, Date, Date]>(async () => {});
  const expiration = { scheduleExpiration };

  const resolveForVariants = jest.fn(async (_sellerId: string, ids: readonly string[]) => {
    if (opts.modeThrows) throw new Error('settings down');
    return new Map(ids.map((id) => [id, opts.mode ?? InventoryMode.NORMAL]));
  });
  const modes = { resolveForVariants };

  const svc = new PickQueueService(
    { client } as unknown as PrismaService,
    orders as unknown as OrderReadService,
    audit as unknown as AuditLogService,
    expiration as unknown as PickExpirationService,
    modes as unknown as InventoryModeService,
  );
  return {
    svc,
    queryRawUnsafe,
    update,
    systemSettingFindUnique,
    getById,
    auditLog,
    scheduleExpiration,
    resolveForVariants,
  };
}

describe('PickQueueService.pullNext', () => {
  it('returns null (QUEUE_EMPTY) when no parcel is pickable', async () => {
    const { svc, update, auditLog, getById, scheduleExpiration } = makeService({
      queue: [],
    });
    expect(await svc.pullNext('staff-1')).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(getById).not.toHaveBeenCalled();
    expect(scheduleExpiration).not.toHaveBeenCalled();
  });

  it('locks FIFO eligible parcels + claims (who/when/expiry) + enriches', async () => {
    const { svc, queryRawUnsafe, update, getById, scheduleExpiration } = makeService({
      queue: ['s1'],
      order: { orderId: 'o1', recipient: { name: 'Asha' } },
      orderIdForShipment: () => 'o1',
    });
    const r = await svc.pullNext('staff-7');
    expect(r).not.toBeNull();

    const sql = queryRawUnsafe.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('FOR UPDATE OF s SKIP LOCKED');
    expect(sql).toContain('ORDER BY s.created_at ASC');
    expect(sql).toContain("s.status = 'created'");
    expect(sql).toContain('s.pick_started_at IS NULL');
    expect(sql).toContain('s.deleted_at IS NULL');
    expect(sql).toContain('o.deleted_at IS NULL');
    expect(sql).toContain("o.status IN ('confirmed','pending_pick')");
    expect(sql).toContain('JOIN order_shipments os ON os.shipment_id = s.id');
    expect(sql).toContain('JOIN orders o ON o.id = os.order_id');

    const data = (update.mock.calls[0]?.[0].data ?? {}) as AnyArgs;
    expect(data.pickStartedByStaffId).toBe('staff-7');
    expect(data.pickStartedAt).toBeInstanceOf(Date);
    expect(data.pickExpiresAt).toBeInstanceOf(Date);

    expect(getById).toHaveBeenCalledWith('o1');
    // WMS-5: timeout sweep armed at claim, before enrichment.
    expect(scheduleExpiration).toHaveBeenCalledWith('s1', expect.any(Date), expect.any(Date));
    expect(r).toMatchObject({
      pickId: 's1',
      shipmentId: 's1',
      shipmentNumber: 'SH-s1',
      orderId: 'o1',
      order: { orderId: 'o1' },
    });
    expect(r?.pickId).toBe(r?.shipmentId); // the pick task IS the shipment
    expect(r?.items).toEqual([
      {
        shipmentItemId: 'si-s1',
        orderItemId: 'oi-s1',
        variantId: 'v-1',
        skuCode: 'SKU-1',
        productName: 'Widget',
        variantLabel: null,
        quantity: 2,
        unitWeightGrams: 100,
        inventoryMode: InventoryMode.NORMAL,
      },
    ]);
  });

  it('defaults the timeout to 4h when ops.pick_task_timeout_hours is unset', async () => {
    const { svc, update } = makeService({ queue: ['s1'] });
    const before = Date.now();
    await svc.pullNext('staff-1');
    const data = (update.mock.calls[0]?.[0].data ?? {}) as {
      pickStartedAt: Date;
      pickExpiresAt: Date;
    };
    const deltaMs = data.pickExpiresAt.getTime() - data.pickStartedAt.getTime();
    expect(deltaMs).toBe(4 * 3_600_000);
    expect(data.pickStartedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('honours a custom ops.pick_task_timeout_hours', async () => {
    const { svc, update, systemSettingFindUnique } = makeService({
      queue: ['s1'],
      timeoutHours: 6,
    });
    await svc.pullNext('staff-1');
    expect(systemSettingFindUnique).toHaveBeenCalledWith({
      where: { key: 'ops.pick_task_timeout_hours' },
      select: { valueInt: true },
    });
    const data = (update.mock.calls[0]?.[0].data ?? {}) as {
      pickStartedAt: Date;
      pickExpiresAt: Date;
    };
    expect(data.pickExpiresAt.getTime() - data.pickStartedAt.getTime()).toBe(6 * 3_600_000);
  });

  it('still claims + returns when the order resolves to null (logged anomaly)', async () => {
    const { svc, update, getById } = makeService({
      queue: ['s1'],
      order: null,
    });
    const r = await svc.pullNext('staff-1');
    expect(update).toHaveBeenCalledTimes(1); // claim still stands
    expect(getById).toHaveBeenCalled();
    expect(r).not.toBeNull();
    expect(r?.order).toBeNull();
  });

  it('handles a missing OrderShipment junction (orderId "", no getById, claim stands)', async () => {
    const { svc, update, getById } = makeService({
      queue: ['s1'],
      orderIdForShipment: () => null,
    });
    const r = await svc.pullNext('staff-1');
    expect(update).toHaveBeenCalledTimes(1);
    expect(getById).not.toHaveBeenCalled(); // no order id to resolve
    expect(r).toMatchObject({ shipmentId: 's1', orderId: '', order: null });
  });
});

describe('PickQueueService.pullNext — concurrency (FOR UPDATE … SKIP LOCKED)', () => {
  it('two parallel pulls on a 1-parcel queue: one winner, one QUEUE_EMPTY', async () => {
    const { svc, update } = makeService({ queue: ['s1'] });
    const [a, b] = await Promise.all([svc.pullNext('staff-1'), svc.pullNext('staff-2')]);
    const got = [a, b].filter((r) => r !== null);
    const empty = [a, b].filter((r) => r === null);
    expect(got).toHaveLength(1); // exactly one winner
    expect(empty).toHaveLength(1); // the other sees QUEUE_EMPTY
    expect(got[0]?.shipmentId).toBe('s1');
    expect(update).toHaveBeenCalledTimes(1); // only the winner claims
  });

  it('two parallel pulls on a 2-parcel queue: distinct parcels (SKIP LOCKED)', async () => {
    const { svc, update } = makeService({ queue: ['s1', 's2'] });
    const [a, b] = await Promise.all([svc.pullNext('staff-1'), svc.pullNext('staff-2')]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const ids = [a?.shipmentId, b?.shipmentId].sort();
    expect(ids).toEqual(['s1', 's2']); // never the same parcel twice
    expect(update).toHaveBeenCalledTimes(2);
    // each picker got its own claim
    const claimedFor = update.mock.calls.map(
      (c) => (c[0].data as { pickStartedByStaffId: string }).pickStartedByStaffId,
    );
    expect(claimedFor.sort()).toEqual(['staff-1', 'staff-2']);
  });
});

describe('PickQueueService.pullNext — R4 inventory mode', () => {
  it('reports STRICT on the line so the picker screen knows serials are required', async () => {
    const { svc, resolveForVariants } = makeService({
      queue: ['s-1'],
      mode: InventoryMode.STRICT,
    });
    const pulled = await svc.pullNext('staff-1');
    expect(pulled?.items[0]?.variantId).toBe('v-1');
    expect(pulled?.items[0]?.inventoryMode).toBe(InventoryMode.STRICT);
    // Batched once for the whole parcel, never a resolve per line.
    expect(resolveForVariants).toHaveBeenCalledTimes(1);
    expect(resolveForVariants).toHaveBeenCalledWith('seller-1', ['v-1']);
  });

  it('resolves AFTER the claim tx so a settings read never lengthens the queue row lock', async () => {
    const { svc, scheduleExpiration, resolveForVariants } = makeService({ queue: ['s-1'] });
    await svc.pullNext('staff-1');
    expect(scheduleExpiration.mock.invocationCallOrder[0]).toBeLessThan(
      resolveForVariants.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('FAILS OPEN to NORMAL when the resolver throws — a settings outage must not stop the pick floor', async () => {
    const { svc } = makeService({ queue: ['s-1'], modeThrows: true });
    const pulled = await svc.pullNext('staff-1');
    expect(pulled?.items[0]?.inventoryMode).toBe(InventoryMode.NORMAL);
  });
});
