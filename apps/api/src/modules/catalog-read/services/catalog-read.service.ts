import { Injectable, Logger } from '@nestjs/common';
import { Prisma, VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AttributeResolutionService,
  type EffectiveAttribute,
} from '../../catalog-attribute/services/attribute-resolution.service';

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
  readonly categoryId: string | null;
  readonly skuCode: string;
  readonly variantLabel: string | null;
  readonly status: VariantStatus;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly weightGrams: number | null;
  readonly lengthCm: Prisma.Decimal | null;
  readonly widthCm: Prisma.Decimal | null;
  readonly heightCm: Prisma.Decimal | null;
  readonly declaredValueInr: Prisma.Decimal | null;
  readonly hsCode: string | null;
  /** Always resolves: variant → category → system default (whole percent
   *  in Phase 1A — see phase-1a-debt). */
  readonly gstRate: Prisma.Decimal;
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
  hsCode: true,
  gstRate: true,
  product: {
    select: {
      categoryId: true,
      deletedAt: true,
      defaultWeightGrams: true,
      defaultLengthCm: true,
      defaultWidthCm: true,
      defaultHeightCm: true,
      defaultDeclaredValueInr: true,
      defaultHsCode: true,
      category: {
        select: {
          id: true,
          deletedAt: true,
          defaultHsCode: true,
          defaultGstRate: true,
        },
      },
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
 * Precedence (highest → lowest): variant → product → category →
 * system_settings. Only gstRate falls all the way to system_settings;
 * the others stop at product (hsCode also considers category).
 *
 * Pure read: no method writes. Returns are frozen.
 */
@Injectable()
export class CatalogReadService {
  private readonly logger = new Logger(CatalogReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attributes: AttributeResolutionService,
  ) {}

  async getVariantById(variantId: string): Promise<ResolvedVariant | null> {
    const map = await this.getVariantsByIds([variantId]);
    return map.get(variantId) ?? null;
  }

  /**
   * Batch resolve. One query for all variants (+ product + category via a
   * nested select) and one query for the GST system default — no N+1
   * regardless of how many ids are passed. Missing/soft-deleted variants
   * (or variants whose product is soft-deleted) are simply absent from
   * the returned map.
   */
  async getVariantsByIds(
    variantIds: string[],
  ): Promise<ReadonlyMap<string, ResolvedVariant>> {
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

  /**
   * Effective attribute set for a variant's category, reusing the
   * AttributeResolutionService Redis cache. Empty when the variant has no
   * category (or is missing) — attributes are then unconstrained.
   */
  async getEffectiveAttributesForVariant(
    variantId: string,
  ): Promise<EffectiveAttribute[]> {
    const v = await this.prisma.client.productVariant.findFirst({
      where: { id: variantId, deletedAt: null, product: { deletedAt: null } },
      select: { product: { select: { categoryId: true } } },
    });
    const categoryId = v?.product.categoryId ?? null;
    if (!categoryId) return [];
    return this.attributes.resolveEffectiveAttributes(categoryId);
  }

  private resolve(
    row: VariantWithChain,
    gstDefault: Prisma.Decimal,
  ): ResolvedVariant {
    const product = row.product;
    // A soft-deleted category contributes nothing to inheritance.
    const category =
      product.category && product.category.deletedAt === null
        ? product.category
        : null;

    return Object.freeze({
      variantId: row.id,
      productId: row.productId,
      sellerId: row.sellerId,
      categoryId: category?.id ?? null,
      skuCode: row.skuCode,
      variantLabel: row.variantLabel,
      status: row.status,
      attributes: Object.freeze(this.coerceAttributes(row.attributes)),
      weightGrams: row.weightGrams ?? product.defaultWeightGrams ?? null,
      lengthCm: row.lengthCm ?? product.defaultLengthCm ?? null,
      widthCm: row.widthCm ?? product.defaultWidthCm ?? null,
      heightCm: row.heightCm ?? product.defaultHeightCm ?? null,
      declaredValueInr:
        row.declaredValueInr ?? product.defaultDeclaredValueInr ?? null,
      hsCode:
        row.hsCode ?? product.defaultHsCode ?? category?.defaultHsCode ?? null,
      gstRate: row.gstRate ?? category?.defaultGstRate ?? gstDefault,
    });
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
    this.logger.warn(
      `${GST_SETTING_KEY} not set; falling back to ${GST_FALLBACK.toString()}%`,
    );
    return GST_FALLBACK;
  }
}
