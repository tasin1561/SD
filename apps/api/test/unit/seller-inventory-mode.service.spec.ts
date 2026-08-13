import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryMode } from '@skydrop/db';
import { SellerInventoryModeService } from '../../src/modules/inventory-stock/services/seller-inventory-mode.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { ClientContext } from '../../src/modules/seller-auth/seller-auth.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const PRODUCT = 'prod-1';
const VARIANT = 'var-1';
const CTX: ClientContext = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

function makeSut(
  opts: {
    /** null → the catalog boundary reports no such variant. */
    variant?: { sellerId: string; productId: string } | null;
    /** The variant's stored value BEFORE the write. */
    storedMode?: InventoryMode | null;
    /** What the shared resolver reports as effective. */
    effective?: InventoryMode;
  } = {},
) {
  let stored = opts.storedMode ?? null;

  const update = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => {
    stored = (args['data'] as { inventoryMode: InventoryMode | null }).inventoryMode;
    return { id: VARIANT };
  });
  const findUnique = jest.fn(async () => ({ inventoryMode: stored }));
  const txClient = { productVariant: { update, findUnique } };
  const client = {} as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const getVariantById = jest.fn(async () =>
    opts.variant === null
      ? null
      : {
          id: VARIANT,
          sellerId: opts.variant?.sellerId ?? SELLER,
          productId: opts.variant?.productId ?? PRODUCT,
        },
  );
  const catalog = { getVariantById } as unknown as CatalogReadService;

  const overrideForVariant = jest.fn(async () => stored);
  const resolveForVariants = jest.fn(
    async (_sellerId: string, ids: readonly string[]) =>
      new Map(ids.map((id) => [id, stored ?? opts.effective ?? InventoryMode.NORMAL])),
  );
  const modes = { overrideForVariant, resolveForVariants } as unknown as InventoryModeService;

  const log = jest.fn<Promise<string | null>, [AnyArgs, unknown]>(async () => 'a1');
  const audit = { log } as unknown as AuditLogService;

  return {
    svc: new SellerInventoryModeService(
      { client } as unknown as PrismaService,
      audit,
      catalog,
      modes,
    ),
    update,
    log,
    getVariantById,
    resolveForVariants,
  };
}

describe('SellerInventoryModeService.setVariantMode', () => {
  it('turns STRICT on and reports it as the effective mode', async () => {
    const { svc, update } = makeSut({ storedMode: null });
    const view = await svc.setVariantMode(SELLER, PRODUCT, VARIANT, InventoryMode.STRICT, CTX);
    expect(update).toHaveBeenCalledWith({
      where: { id: VARIANT },
      data: { inventoryMode: InventoryMode.STRICT },
    });
    expect(view.inventoryMode).toBe(InventoryMode.STRICT);
    expect(view.effectiveInventoryMode).toBe(InventoryMode.STRICT);
    expect(view.inherited).toBe(false);
  });

  it('null CLEARS the override back to inherit — it is not a synonym for NORMAL', async () => {
    const { svc, update } = makeSut({
      storedMode: InventoryMode.STRICT,
      effective: InventoryMode.STRICT,
    });
    const view = await svc.setVariantMode(SELLER, PRODUCT, VARIANT, null, CTX);
    expect(update).toHaveBeenCalledWith({
      where: { id: VARIANT },
      data: { inventoryMode: null },
    });
    expect(view.inventoryMode).toBeNull();
    expect(view.inherited).toBe(true);
    // The seller default still says STRICT, so the floor gates still
    // enforce it — "cleared" must not read as "off".
    expect(view.effectiveInventoryMode).toBe(InventoryMode.STRICT);
  });

  it('audits the real prior value at MEDIUM — this is the row someone reads when a parcel is stuck', async () => {
    const { svc, log } = makeSut({ storedMode: InventoryMode.NORMAL });
    await svc.setVariantMode(SELLER, PRODUCT, VARIANT, InventoryMode.STRICT, CTX);
    const [entry] = log.mock.calls[0] ?? [];
    expect(entry).toMatchObject({
      action: 'inventory.mode.variant_updated',
      entityType: 'product_variant',
      entityId: VARIANT,
      severity: 'MEDIUM',
      changes: { inventoryMode: { from: InventoryMode.NORMAL, to: InventoryMode.STRICT } },
    });
  });

  it("refuses another seller's variant without disclosing it exists", async () => {
    const { svc, update } = makeSut({ variant: { sellerId: 'other', productId: PRODUCT } });
    await expect(
      svc.setVariantMode(SELLER, PRODUCT, VARIANT, InventoryMode.STRICT, CTX),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a variant that belongs to a different product than the path claims', async () => {
    const { svc, update } = makeSut({ variant: { sellerId: SELLER, productId: 'other-product' } });
    await expect(
      svc.setVariantMode(SELLER, PRODUCT, VARIANT, InventoryMode.STRICT, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('validates ownership through the catalog boundary, never a direct variant query', async () => {
    const { svc, getVariantById } = makeSut();
    await svc.setVariantMode(SELLER, PRODUCT, VARIANT, InventoryMode.NORMAL, CTX);
    expect(getVariantById).toHaveBeenCalledWith(VARIANT);
  });
});

describe('SellerInventoryModeService.getVariantMode', () => {
  it('reports inherited when the variant carries no value of its own', async () => {
    const { svc, resolveForVariants } = makeSut({
      storedMode: null,
      effective: InventoryMode.STRICT,
    });
    const view = await svc.getVariantMode(SELLER, PRODUCT, VARIANT);
    expect(view.inventoryMode).toBeNull();
    expect(view.inherited).toBe(true);
    expect(view.effectiveInventoryMode).toBe(InventoryMode.STRICT);
    // Effective comes from the SAME resolver the pick/pack gates use, so
    // the screen and the gate can never disagree.
    expect(resolveForVariants).toHaveBeenCalledWith(SELLER, [VARIANT]);
  });

  it('404s on an unknown variant', async () => {
    const { svc } = makeSut({ variant: null });
    await expect(svc.getVariantMode(SELLER, PRODUCT, VARIANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
