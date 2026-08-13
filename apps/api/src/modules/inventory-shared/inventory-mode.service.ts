import { Injectable, Logger } from '@nestjs/common';
import { InventoryMode } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../settings/services/settings-resolver.service';

const MODE_SETTING_KEY = 'inventory.default_inventory_mode';

/**
 * R4 — resolves which inventory MODE a SKU runs in.
 *
 * Precedence (deliberately the same shape as the M4 property-inheritance
 * rule and the M5 low-stock threshold): the variant's own
 * `inventory_mode` wins; null falls back to the seller's
 * `inventory.default_inventory_mode` setting; that in turn falls back to
 * the seeded system default (NORMAL). A seller can therefore flip their
 * whole catalogue to strict, or run strict on the two SKUs where a
 * missing unit actually hurts.
 *
 * FAIL-OPEN is deliberate: if the setting cannot be read, we resolve
 * NORMAL rather than STRICT. Resolving STRICT on a settings outage would
 * start rejecting picks for SKUs that were never serialized — a floor
 * stoppage caused by an infrastructure blip. The failure mode of
 * resolving NORMAL is that one pick isn't scan-enforced, which is
 * recoverable and visible in the discrepancy report.
 */
@Injectable()
export class InventoryModeService {
  private readonly logger = new Logger(InventoryModeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  /**
   * The variant's OWN value, un-resolved — `null` means "inherit", which
   * the resolved forms deliberately cannot express. Only a config screen
   * needs this; every gate wants `resolveForVariant(s)` instead.
   *
   * Lives here so this service stays the single reader of the
   * inventory-owned `product_variants.inventory_mode` column (the
   * MUST #13 clarification: inventory owns the column, and reads of it
   * go through one place rather than being spread across callers).
   */
  async overrideForVariant(variantId: string): Promise<InventoryMode | null> {
    const variant = await this.prisma.client.productVariant.findUnique({
      where: { id: variantId },
      select: { inventoryMode: true },
    });
    return variant?.inventoryMode ?? null;
  }

  /** Resolve one variant's effective mode. */
  async resolveForVariant(sellerId: string, variantId: string): Promise<InventoryMode> {
    const variant = await this.prisma.client.productVariant.findUnique({
      where: { id: variantId },
      select: { inventoryMode: true },
    });
    if (variant?.inventoryMode) return variant.inventoryMode;
    return this.sellerDefault(sellerId);
  }

  /**
   * Batch form for the gates, which deal in whole parcels. Returns a map
   * keyed by variantId. One settings read for the whole call.
   */
  async resolveForVariants(
    sellerId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, InventoryMode>> {
    const unique = [...new Set(variantIds)];
    const out = new Map<string, InventoryMode>();
    if (unique.length === 0) return out;

    const [variants, fallback] = await Promise.all([
      this.prisma.client.productVariant.findMany({
        where: { id: { in: unique } },
        select: { id: true, inventoryMode: true },
      }),
      this.sellerDefault(sellerId),
    ]);
    const byId = new Map(variants.map((v) => [v.id, v.inventoryMode]));
    for (const id of unique) {
      out.set(id, byId.get(id) ?? fallback);
    }
    return out;
  }

  /**
   * The prefix to print on serials Skydrop generates. Cosmetic only —
   * uniqueness comes from the generated body and the unique index — so an
   * unreadable setting falls back to the seeded default rather than
   * failing a receipt.
   */
  async serialPrefixFor(sellerId: string): Promise<string> {
    try {
      const resolved = await this.settings.resolve(sellerId, 'inventory.strict_unit_serial_prefix');
      const value = String(resolved.value ?? '').trim();
      return value.length > 0 ? value : 'SDU';
    } catch {
      return 'SDU';
    }
  }

  /** The seller's fallback mode. Fails open to NORMAL (see class doc). */
  async sellerDefault(sellerId: string): Promise<InventoryMode> {
    try {
      const resolved = await this.settings.resolve(sellerId, MODE_SETTING_KEY);
      return String(resolved.value).toUpperCase() === 'STRICT'
        ? InventoryMode.STRICT
        : InventoryMode.NORMAL;
    } catch (err) {
      this.logger.warn(
        { sellerId, err: (err as Error).message },
        'Inventory-mode setting unreadable; resolving NORMAL (fail-open)',
      );
      return InventoryMode.NORMAL;
    }
  }
}
