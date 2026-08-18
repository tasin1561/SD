import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { InventoryModeService } from '../../inventory-shared/inventory-mode.service';
import { InventoryMode } from '@skydrop/db';

export interface VariantInventoryModeView {
  variantId: string;
  productId: string;
  /** The variant's OWN value. `null` means "inherit" — see the DTO. */
  inventoryMode: InventoryMode | null;
  /** What the pick/pack/receipt gates will actually enforce today. */
  effectiveInventoryMode: InventoryMode;
  /** True when `effectiveInventoryMode` came from the seller default
   *  rather than this variant — the UI needs to say "inherited" instead
   *  of implying the SKU was configured. */
  inherited: boolean;
}

/**
 * R4 — seller-managed per-variant inventory mode.
 *
 * SELLER-side, not admin-side, deliberately: the catalogue is the
 * seller's (products/variants are `sellerId`-scoped, the seller uploads
 * the CSV and owns the SKU codes), and the fallback this column
 * overrides — `inventory.default_inventory_mode` — is already a
 * seller-overridable SET-1 setting. Putting the per-SKU exception on the
 * other side of the wall from its own default would mean a seller could
 * make their whole catalogue strict but not exempt the one SKU that has
 * no serials on it, and would have to raise a ticket to do so.
 *
 * `inventoryMode` is an inventory-owned scalar that physically lives on
 * `product_variants` — the same arrangement as `lowStockThreshold`.
 * Ownership/existence is validated through the sanctioned
 * CatalogReadService boundary (no direct product_variants READ — CLAUDE
 * MUST #13), and only the single inventory-owned column is written.
 *
 * No cache invalidation: the mode changes which gates run at pick/pack/
 * receipt, not any quantity, so nothing in the stock display cache is
 * derived from it (contrast SellerThresholdService, where isLowStock is).
 */
@Injectable()
export class SellerInventoryModeService {
  constructor(
    private readonly catalog: CatalogReadService,
    private readonly modes: InventoryModeService,
  ) {}

  async getVariantMode(
    sellerId: string,
    productId: string,
    variantId: string,
  ): Promise<VariantInventoryModeView> {
    await this.assertOwnedVariant(sellerId, productId, variantId);
    return this.view(sellerId, productId, variantId);
  }

  // ---------- internal ----------

  /** Sanctioned read boundary: confirms the variant exists, is this
   *  seller's, and belongs to the path's product. */
  private async assertOwnedVariant(
    sellerId: string,
    productId: string,
    variantId: string,
  ): Promise<void> {
    const variant = await this.catalog.getVariantById(variantId);
    if (!variant || variant.sellerId !== sellerId) {
      throw new NotFoundException({
        code: 'VARIANT_NOT_FOUND',
        message: 'Variant not found',
      });
    }
    if (variant.productId !== productId) {
      throw new BadRequestException({
        code: 'VARIANT_PRODUCT_MISMATCH',
        message: 'Variant does not belong to the specified product',
      });
    }
  }

  /** Reports the explicit value AND what the gates will enforce, because
   *  "null" alone tells a screen nothing about whether this SKU needs
   *  serials. `resolveForVariants` is the same resolver the pick/pack
   *  gates use, so the two can never disagree. */
  private async view(
    sellerId: string,
    productId: string,
    variantId: string,
  ): Promise<VariantInventoryModeView> {
    const [own, resolved] = await Promise.all([
      this.modes.overrideForVariant(variantId),
      this.modes.resolveForVariants(sellerId, [variantId]),
    ]);
    return {
      variantId,
      productId,
      inventoryMode: own,
      effectiveInventoryMode: resolved.get(variantId) ?? InventoryMode.NORMAL,
      inherited: own === null,
    };
  }
}
