import { InventoryMode } from '@skydrop/db';
import { GoodsReceiptService } from '../../src/modules/inventory-receipt/services/goods-receipt.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { WarehouseResolverService } from '../../src/modules/inventory-shared/warehouse-resolver.service';
import type { StockMutationService } from '../../src/modules/inventory-shared/stock-mutation.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { StockAlertService } from '../../src/modules/inventory-shared/stock-alert.service';
import type { BinPolicyService } from '../../src/modules/inventory-shared/bin-policy.service';
import type { StockCacheService } from '../../src/modules/inventory-shared/stock-cache.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { EnvService } from '../../src/config/env.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';

const RECEIPT = {
  id: 'gr-1',
  sellerId: 's-1',
  status: 'arriving',
  lines: [
    { id: 'l-1', variantId: 'v-strict', expectedQty: 4 },
    { id: 'l-2', variantId: 'v-plain', expectedQty: 2 },
  ],
};

function makeSut(opts: { modes?: Record<string, InventoryMode>; modeThrows?: boolean } = {}) {
  const findFirst = jest.fn(async () => JSON.parse(JSON.stringify(RECEIPT)) as typeof RECEIPT);
  const prisma = {
    client: { goodsReceipt: { findFirst } },
  } as unknown as PrismaService;

  const resolveForVariants = jest.fn(async (_sellerId: string, ids: readonly string[]) => {
    if (opts.modeThrows) throw new Error('settings down');
    return new Map(ids.map((id) => [id, opts.modes?.[id] ?? InventoryMode.NORMAL]));
  });
  const modes = { resolveForVariants } as unknown as InventoryModeService;
  const noop = {} as unknown;

  const svc = new GoodsReceiptService(
    prisma,
    noop as AuditLogService,
    noop as CatalogReadService,
    noop as WarehouseResolverService,
    noop as StockMutationService,
    noop as StockUnitService,
    modes,
    noop as StockAlertService,
    noop as BinPolicyService,
    // Two-leg consignments: an arrival out of TRANSIT, and the R3
    // consignment-core primitives the completion writes through. Neither
    // suite exercises a consignment leg, so a bare stub is honest —
    // transit-arrival.service.spec.ts owns that path.
    noop as never,
    { append: async () => ({ id: 'ce1' }) } as never,
    { recompute: async () => 'PENDING' } as never,
    noop as StockCacheService,
    noop as EmailQueue,
    noop as EnvService,
    // Only the per-line thumbnail uses this; a stub keeps the
    // receiving tests about receiving.
    { presignGetUrl: async () => 'https://example.test/img' } as unknown as SpacesService,
  );
  return { svc, resolveForVariants, findFirst };
}

describe('GoodsReceiptService.getDetailForAdmin — R4 inventory mode', () => {
  it('stamps each line with the mode receiving will enforce', async () => {
    const { svc } = makeSut({ modes: { 'v-strict': InventoryMode.STRICT } });
    const detail = await svc.getDetailForAdmin('gr-1');
    expect(detail.lines[0]?.inventoryMode).toBe(InventoryMode.STRICT);
    expect(detail.lines[1]?.inventoryMode).toBe(InventoryMode.NORMAL);
  });

  it('resolves every line in ONE batched call, not once per line', async () => {
    const { svc, resolveForVariants } = makeSut();
    await svc.getDetailForAdmin('gr-1');
    expect(resolveForVariants).toHaveBeenCalledTimes(1);
    expect(resolveForVariants).toHaveBeenCalledWith('s-1', ['v-strict', 'v-plain']);
  });

  it('FAILS OPEN to NORMAL when the resolver throws — a settings outage must not block booking stock in', async () => {
    const { svc } = makeSut({ modeThrows: true });
    const detail = await svc.getDetailForAdmin('gr-1');
    expect(detail.lines.map((l) => l.inventoryMode)).toEqual([
      InventoryMode.NORMAL,
      InventoryMode.NORMAL,
    ]);
  });

  it('leaves the rest of the receipt untouched', async () => {
    const { svc } = makeSut();
    const detail = await svc.getDetailForAdmin('gr-1');
    expect(detail.id).toBe('gr-1');
    expect(detail.lines[0]?.expectedQty).toBe(4);
  });
});
