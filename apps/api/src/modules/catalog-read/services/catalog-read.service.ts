import { Injectable, Logger } from '@nestjs/common';
import { Prisma, VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { displayImageKey } from '../../catalog-image/image-key';

const GST_SETTING_KEY = 'pricing.gst_rate';
/** Used only if the system_settings row is missing — schema seeds 18.00. */
const GST_FALLBACK = new Prisma.Decimal('18');

/**
 * A variant with every shipping/customs property resolved through the
 * inheritance chain. Frozen so a cross-module consumer (pricing, orders,
 * shipments) cannot mutate catalog state by accident.
 */
export interface ResolvedVariant {
  readonly variantId: string;
  readonly productId: string;
  readonly sellerId: string;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly status: VariantStatus;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly weightGrams: number | null;
  readonly lengthCm: Prisma.Decimal | null;
  readonly widthCm: Prisma.Decimal | null;
  readonly heightCm: Prisma.Decimal | null;
  readonly declaredValueInr: Prisma.Decimal | null;
  /** Always resolves: variant → system default (whole percent in Phase
   *  1A — see phase-1a-debt). */
  readonly gstRate: Prisma.Decimal;
  /**
   * Inventory-owned passthrough (Module 5). The RAW per-variant
   * `product_variants.low_stock_threshold` (NOT inheritance-resolved here —
   * the seller-default fallback is inventory's own logic). Surfaced on this
   * boundary purely so inventory can honor CLAUDE MUST #13 ("never query
   * product_variants directly outside the catalog modules"); catalog does
   * not interpret it.
   */
  readonly lowStockThreshold: number | null;
  /**
   * Order-snapshot passthroughs (Module 6, expand-by-need — see
   * phase-1a-debt "CatalogReadService expansion-by-need"). `productName`
   * is `products.name`; `imageUrl` is the primary image URL (isPrimary,
   * else lowest displayOrder) among non-deleted images, or null. Surfaced
   * here purely so OrderService can snapshot SKU display info onto
   * order_items without querying products/product_images directly
   * (CLAUDE MUST #13). Catalog does not interpret these.
   */
  readonly productName: string;
  readonly imageUrl: string | null;
}

const VARIANT_SELECT = {
  id: true,
  productId: true,
  sellerId: true,
  skuCode: true,
  variantLabel: true,
  status: true,
  attributes: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  declaredValueInr: true,
  gstRate: true,
  lowStockThreshold: true,
  images: {
    where: { deletedAt: null },
    select: { url: true, isPrimary: true, displayOrder: true },
  },
  product: {
    select: {
      name: true,
      deletedAt: true,
      defaultWeightGrams: true,
      defaultLengthCm: true,
      defaultWidthCm: true,
      defaultHeightCm: true,
      defaultDeclaredValueInr: true,
    },
  },
} as const;

type VariantWithChain = Prisma.ProductVariantGetPayload<{
  select: typeof VARIANT_SELECT;
}>;

/**
 * The ONLY sanctioned cross-module entry point for reading catalog
 * variants. Other modules (orders, pricing, shipments, WMS) MUST go
 * through this service rather than querying products/variants directly,
 * so property-inheritance precedence stays defined in one place.
 *
 * Precedence (highest → lowest): variant → product → system_settings.
 * Only gstRate reaches system_settings; every other property stops at
 * the product, and a null all the way down is a validation error at the
 * point of use rather than a silent default.
 *
 * Pure read: no method writes. Returns are frozen.
 */
@Injectable()
export class CatalogReadService {
  private readonly logger = new Logger(CatalogReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
  ) {}

  /**
   * A presigned thumbnail per variant, for showing the picture next to a
   * line a consumer already holds (an order's items, a picking list).
   *
   * This is a LIVE lookup, deliberately NOT part of the ORD-6 snapshot.
   * The snapshot's `imageUrl` column stores the canonical object URL,
   * and since the bucket went private (2026-07-28) that URL resolves for
   * nobody — every order placed since then carries a dead link. A
   * presigned URL expires in minutes, so it cannot be snapshotted
   * either; the only correct shape is to mint one at read time.
   *
   * The consequence, stated rather than discovered later: an order line
   * shows the product's CURRENT primary picture, not the one that was
   * primary the day it was ordered. The name, SKU, weight and value stay
   * snapshotted and immutable — only the photograph is live. That is the
   * right trade for a thumbnail whose job is "which of my products is
   * this"; a picture is how the seller recognises the line, and a broken
   * image tells them nothing at all.
   *
   * One query for every variant asked about, never one per line.
   */
  async thumbnailUrlsByVariant(
    variantIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const info = await this.displayInfoByVariant(variantIds);
    const out = new Map<string, string>();
    for (const [id, v] of info) if (v.thumbnailUrl !== null) out.set(id, v.thumbnailUrl);
    return out;
  }

  /**
   * Thumbnail + product description for a set of variants, in ONE pair
   * of queries however many lines are asked about.
   *
   * The description is the PRODUCT's (variants have none) and is LIVE,
   * like the picture and for the same reason — it describes an item that
   * still exists and is still being sold, so the current text is the
   * correct one. The ORD-6 snapshot keeps name, SKU, weight and value;
   * these two are display sugar that must never be read back as what was
   * ordered.
   *
   * Exists because a call-centre agent is asked "what is it?" mid-call
   * and a SKU code does not answer that.
   */
  async displayInfoByVariant(
    variantIds: readonly string[],
  ): Promise<ReadonlyMap<string, { thumbnailUrl: string | null; description: string | null }>> {
    const ids = [...new Set(variantIds)];
    const empty = new Map<string, { thumbnailUrl: string | null; description: string | null }>();
    if (ids.length === 0) return empty;

    const [variants, images] = await Promise.all([
      this.prisma.client.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true, product: { select: { description: true } } },
      }),
      // Same ordering as the images page and the variant list (primary
      // first, then display order, then age), so all three agree on
      // which picture is "the" picture.
      this.prisma.client.productImage.findMany({
        where: { variantId: { in: ids }, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
        select: { variantId: true, spacesKey: true, thumbnailUrl: true },
      }),
    ]);

    const firstImage = new Map<string, (typeof images)[number]>();
    for (const img of images) {
      if (!firstImage.has(img.variantId)) firstImage.set(img.variantId, img);
    }

    const out = new Map<string, { thumbnailUrl: string | null; description: string | null }>();
    await Promise.all(
      variants.map(async (v) => {
        const img = firstImage.get(v.id);
        out.set(v.id, {
          thumbnailUrl:
            img === undefined ? null : await this.spaces.presignGetUrl(displayImageKey(img)),
          description: v.product.description,
        });
      }),
    );
    return out;
  }

  async getVariantById(variantId: string): Promise<ResolvedVariant | null> {
    const map = await this.getVariantsByIds([variantId]);
    return map.get(variantId) ?? null;
  }

  /**
   * Resolve a variant by its per-seller SKU (product_variants is
   * @@unique([sellerId, skuCode]), so this is an unambiguous single
   * lookup). Sanctioned expand-by-need boundary read added for Module 6
   * CSV import (productSku → variant) so the importer never queries
   * product_variants directly (CLAUDE MUST #13). Soft-deleted variant /
   * product → null.
   */
  async getVariantBySku(sellerId: string, skuCode: string): Promise<ResolvedVariant | null> {
    const [row, gstDefault] = await Promise.all([
      this.prisma.client.productVariant.findFirst({
        where: { sellerId, skuCode, deletedAt: null, product: { deletedAt: null } },
        select: VARIANT_SELECT,
      }),
      this.resolveGstDefault(),
    ]);
    return row ? this.resolve(row, gstDefault) : null;
  }

  /**
   * Batch resolve. One query for all variants (+ product via a nested
   * select) and one query for the GST system default — no N+1
   * regardless of how many ids are passed. Missing/soft-deleted variants
   * (or variants whose product is soft-deleted) are simply absent from
   * the returned map.
   */
  async getVariantsByIds(variantIds: string[]): Promise<ReadonlyMap<string, ResolvedVariant>> {
    const ids = [...new Set(variantIds)];
    const out = new Map<string, ResolvedVariant>();
    if (ids.length === 0) return out;

    const [rows, gstDefault] = await Promise.all([
      this.prisma.client.productVariant.findMany({
        where: { id: { in: ids }, deletedAt: null, product: { deletedAt: null } },
        select: VARIANT_SELECT,
      }),
      this.resolveGstDefault(),
    ]);

    for (const row of rows) {
      out.set(row.id, this.resolve(row, gstDefault));
    }
    return out;
  }

  private resolve(row: VariantWithChain, gstDefault: Prisma.Decimal): ResolvedVariant {
    const product = row.product;

    return Object.freeze({
      variantId: row.id,
      productId: row.productId,
      sellerId: row.sellerId,
      skuCode: row.skuCode,
      variantLabel: row.variantLabel,
      status: row.status,
      attributes: Object.freeze(this.coerceAttributes(row.attributes)),
      weightGrams: row.weightGrams ?? product.defaultWeightGrams ?? null,
      lengthCm: row.lengthCm ?? product.defaultLengthCm ?? null,
      widthCm: row.widthCm ?? product.defaultWidthCm ?? null,
      heightCm: row.heightCm ?? product.defaultHeightCm ?? null,
      declaredValueInr: row.declaredValueInr ?? product.defaultDeclaredValueInr ?? null,
      gstRate: row.gstRate ?? gstDefault,
      lowStockThreshold: row.lowStockThreshold ?? null,
      productName: product.name,
      // Primary image: isPrimary wins, else lowest displayOrder. Picked
      // in code so VARIANT_SELECT stays a plain `as const` (Prisma rejects
      // a readonly `orderBy` tuple).
      imageUrl: this.pickPrimaryImageUrl(row.images),
    });
  }

  private pickPrimaryImageUrl(
    images: ReadonlyArray<{ url: string; isPrimary: boolean; displayOrder: number }>,
  ): string | null {
    let best: { url: string; isPrimary: boolean; displayOrder: number } | null = null;
    for (const img of images) {
      if (
        best === null ||
        (img.isPrimary && !best.isPrimary) ||
        (img.isPrimary === best.isPrimary && img.displayOrder < best.displayOrder)
      ) {
        best = img;
      }
    }
    return best?.url ?? null;
  }

  private coerceAttributes(raw: Prisma.JsonValue | null): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...(raw as Record<string, unknown>) };
    }
    return {};
  }

  private async resolveGstDefault(): Promise<Prisma.Decimal> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: GST_SETTING_KEY },
      select: { valueDecimal: true, valueInt: true },
    });
    if (row?.valueDecimal != null) return row.valueDecimal;
    if (row?.valueInt != null) return new Prisma.Decimal(row.valueInt);
    this.logger.warn(`${GST_SETTING_KEY} not set; falling back to ${GST_FALLBACK.toString()}%`);
    return GST_FALLBACK;
  }
}
