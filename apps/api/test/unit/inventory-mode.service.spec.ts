import { InventoryMode, SettingValueType } from '@skydrop/db';
import { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

const SELLER = 'seller-1';

function makeSut(
  opts: {
    variants?: Array<{ id: string; inventoryMode: InventoryMode | null }>;
    sellerDefault?: string;
    settingsThrows?: boolean;
  } = {},
) {
  const findUnique = jest.fn(async (args: AnyArgs) => {
    const id = String((args['where'] as AnyArgs)['id']);
    return opts.variants?.find((v) => v.id === id) ?? null;
  });
  const findMany = jest.fn(async () => opts.variants ?? []);
  const prisma = {
    client: { productVariant: { findUnique, findMany } },
  } as unknown as PrismaService;

  const resolve = jest.fn(async (_sellerId: string, key: string) => {
    if (opts.settingsThrows) throw new Error('settings down');
    return {
      key,
      valueType: SettingValueType.STRING,
      value:
        key === 'inventory.strict_unit_serial_prefix' ? 'ACME' : (opts.sellerDefault ?? 'NORMAL'),
      source: 'SYSTEM_DEFAULT' as const,
    };
  });
  const settings = { resolve } as unknown as SettingsResolverService;

  return { svc: new InventoryModeService(prisma, settings), resolve, findMany };
}

describe('InventoryModeService.resolveForVariant', () => {
  it("the variant's own mode wins over the seller default", async () => {
    const { svc } = makeSut({
      variants: [{ id: 'v-1', inventoryMode: InventoryMode.STRICT }],
      sellerDefault: 'NORMAL',
    });
    await expect(svc.resolveForVariant(SELLER, 'v-1')).resolves.toBe(InventoryMode.STRICT);
  });

  it('a null variant mode falls back to the seller default', async () => {
    const { svc } = makeSut({
      variants: [{ id: 'v-1', inventoryMode: null }],
      sellerDefault: 'STRICT',
    });
    await expect(svc.resolveForVariant(SELLER, 'v-1')).resolves.toBe(InventoryMode.STRICT);
  });

  it('defaults to NORMAL — strict is opt-in, never inferred', async () => {
    const { svc } = makeSut({ variants: [{ id: 'v-1', inventoryMode: null }] });
    await expect(svc.resolveForVariant(SELLER, 'v-1')).resolves.toBe(InventoryMode.NORMAL);
  });

  it('a missing variant still resolves (to the seller default) rather than throwing', async () => {
    const { svc } = makeSut({ sellerDefault: 'STRICT' });
    await expect(svc.resolveForVariant(SELLER, 'ghost')).resolves.toBe(InventoryMode.STRICT);
  });

  it('FAILS OPEN to NORMAL when settings are unreadable — a settings outage must never stop the pick floor', async () => {
    const { svc } = makeSut({
      variants: [{ id: 'v-1', inventoryMode: null }],
      settingsThrows: true,
    });
    await expect(svc.resolveForVariant(SELLER, 'v-1')).resolves.toBe(InventoryMode.NORMAL);
  });
});

describe('InventoryModeService.resolveForVariants (batch)', () => {
  it('resolves per-variant and reads the seller default exactly once', async () => {
    const { svc, resolve } = makeSut({
      variants: [
        { id: 'v-1', inventoryMode: InventoryMode.STRICT },
        { id: 'v-2', inventoryMode: null },
      ],
      sellerDefault: 'NORMAL',
    });
    const map = await svc.resolveForVariants(SELLER, ['v-1', 'v-2', 'v-1']);
    expect(map.get('v-1')).toBe(InventoryMode.STRICT);
    expect(map.get('v-2')).toBe(InventoryMode.NORMAL);
    expect(map.size).toBe(2); // deduped
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('an empty list short-circuits without touching settings', async () => {
    const { svc, resolve } = makeSut();
    const map = await svc.resolveForVariants(SELLER, []);
    expect(map.size).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('a variant the catalog does not return still gets the fallback mode', async () => {
    const { svc } = makeSut({ variants: [], sellerDefault: 'STRICT' });
    const map = await svc.resolveForVariants(SELLER, ['ghost']);
    expect(map.get('ghost')).toBe(InventoryMode.STRICT);
  });
});

describe('InventoryModeService.serialPrefixFor', () => {
  it('uses the configured prefix', async () => {
    const { svc } = makeSut();
    await expect(svc.serialPrefixFor(SELLER)).resolves.toBe('ACME');
  });

  it('falls back to SDU when the setting is unreadable — cosmetic only, never blocks a receipt', async () => {
    const { svc } = makeSut({ settingsThrows: true });
    await expect(svc.serialPrefixFor(SELLER)).resolves.toBe('SDU');
  });
});
