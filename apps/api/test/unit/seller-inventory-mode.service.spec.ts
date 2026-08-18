import { NotFoundException } from '@nestjs/common';
import { InventoryMode } from '@skydrop/db';
import { SellerInventoryModeService } from '../../src/modules/inventory-stock/services/seller-inventory-mode.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';
const PRODUCT = 'prod-1';
const VARIANT = 'var-1';

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

  return {
    // Two dependencies, not four: prisma and the audit log went with the
    // write path — a read neither mutates nor is worth an audit row.
    svc: new SellerInventoryModeService(catalog, modes),
    update,
    getVariantById,
    resolveForVariants,
  };
}

/**
 * The WRITE tests were removed on 2026-08-19 with the write itself.
 *
 * A seller can no longer set a variant's inventory mode: it decides
 * whether our staff must scan a serial for every physical unit at pick,
 * pack and RTO, which is our operating procedure rather than a seller
 * preference. It is an admin call now — per seller through the settings
 * override, or globally. What remains is the READ, because a seller
 * whose SKU is on strict tracking should be able to see that it is.
 */
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
