import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Prisma, VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { CreateVariantDto } from '../dto/create-variant.dto';
import type { UpdateVariantDto } from '../dto/update-variant.dto';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { deriveThumbnailKey } from '../../catalog-image/image-key';

export interface VariantSearchHit {
  id: string;
  productId: string;
  skuCode: string;
  variantLabel: string | null;
  productName: string;
  /** So a picker can show the thing, not just name it. Null when the
   *  variant has no image. */
  primaryImageUrl: string | null;
}

export interface VariantView {
  id: string;
  /** Set only by the LIST — a single thumbnail so a colour is
   *  recognisable without decoding the SKU. Null when the SKU has none. */
  primaryImageUrl?: string | null;
  productId: string;
  sellerId: string;
  skuCode: string;
  attributes: Prisma.JsonValue | null;
  variantLabel: string | null;
  weightGrams: number | null;
  lengthCm: Prisma.Decimal | null;
  widthCm: Prisma.Decimal | null;
  heightCm: Prisma.Decimal | null;
  declaredValueInr: Prisma.Decimal | null;
  gstRate: Prisma.Decimal | null;
  barcode: string | null;
  status: VariantStatus;
  createdAt: Date;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  productId: true,
  sellerId: true,
  skuCode: true,
  attributes: true,
  variantLabel: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  declaredValueInr: true,
  gstRate: true,
  barcode: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function dec(n: number | null | undefined): Prisma.Decimal | null {
  return n === null || n === undefined ? null : new Prisma.Decimal(n);
}

@Injectable()
export class CatalogVariantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    // For the list's per-SKU thumbnail. Every stored object is private,
    // so a URL is minted per request rather than kept in a column.
    private readonly spaces: SpacesService,
  ) {}

  async create(
    sellerId: string,
    productId: string,
    input: CreateVariantDto,
    ctx: ClientContext,
  ): Promise<VariantView> {
    await this.requireProduct(sellerId, productId);
    const attributes = input.attributes ?? {};

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.productVariant.create({
          data: {
            productId,
            sellerId,
            skuCode: input.skuCode,
            attributes: attributes as Prisma.InputJsonValue,
            variantLabel: input.variantLabel ?? null,
            weightGrams: input.weightGrams ?? null,
            lengthCm: dec(input.lengthCm),
            widthCm: dec(input.widthCm),
            heightCm: dec(input.heightCm),
            declaredValueInr: dec(input.declaredValueInr),
            gstRate: dec(input.gstRate),
            barcode: input.barcode ?? null,
          },
          select: VIEW_SELECT,
        });
        await this.audit.log(
          {
            actorType: ActorType.SELLER,
            sellerId,
            action: 'catalog.variant.created',
            entityType: 'product_variant',
            entityId: row.id,
            metadata: {
              productId,
              skuCode: row.skuCode,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
              requestId: ctx.requestId,
            },
          },
          tx,
        );
        return row;
      });
      return created;
    } catch (err) {
      throw this.mapSkuConflict(err, input.skuCode);
    }
  }

  async listForProduct(sellerId: string, productId: string): Promise<VariantView[]> {
    await this.requireProduct(sellerId, productId);
    const variants = await this.prisma.client.productVariant.findMany({
      where: { productId, sellerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: VIEW_SELECT,
    });
    if (variants.length === 0) return [];

    // ONE picture per SKU, for the list.
    //
    // A colour is a thing you recognise by looking, and a table of
    // AVIATO-GREE-BLAC / AVIATO-BLAC-GOLD makes the seller decode the SKU
    // to find the green one. The image is fetched in a SINGLE query
    // across every variant of the product rather than one per row —
    // twelve variants would otherwise be twelve round trips to render a
    // list nobody has clicked into yet.
    //
    // Same ordering as the images page (primary first, then display
    // order, then age), so the thumbnail here is the one that page calls
    // primary and the two never disagree.
    const images = await this.prisma.client.productImage.findMany({
      where: { variantId: { in: variants.map((v) => v.id) }, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { variantId: true, spacesKey: true, thumbnailUrl: true },
    });

    const firstFor = new Map<string, (typeof images)[number]>();
    for (const img of images) {
      if (!firstFor.has(img.variantId)) firstFor.set(img.variantId, img);
    }

    return Promise.all(
      variants.map(async (v) => {
        const img = firstFor.get(v.id);
        if (img === undefined) return { ...v, primaryImageUrl: null };
        // Presigned on read, never a stored URL — every object in the
        // bucket is private (2026-07-27). Prefer the thumbnail: this is a
        // 32px cell, and the original can be several megabytes.
        // `thumbnailUrl` non-null means the thumbnail job ran, so the
        // derived key exists; otherwise fall back to the original.
        // deriveThumbnailKey returns null for a key it cannot parse, so
        // fall back to the original rather than dropping the picture.
        const key =
          (img.thumbnailUrl !== null ? deriveThumbnailKey(img.spacesKey) : null) ?? img.spacesKey;
        return { ...v, primaryImageUrl: await this.spaces.presignGetUrl(key) };
      }),
    );
  }

  /**
   * Every variant this seller has, matched on SKU or product name.
   *
   * Exists because a variant is chosen by a HUMAN in three places — an
   * order line, a consignment line, a stock correction — and the only
   * way to name one was its uuid. The alternative shape, product select
   * then variant select, needs the whole product list client-side and
   * already carries a comment admitting it breaks past a hundred
   * products.
   *
   * Capped rather than paged: this feeds a type-ahead, where the answer
   * to "too many matches" is a longer query, not a second page.
   */
  async searchForSeller(
    sellerId: string,
    search: string,
    limit: number,
  ): Promise<VariantSearchHit[]> {
    const q = search.trim();
    const rows = await this.prisma.client.productVariant.findMany({
      where: {
        sellerId,
        deletedAt: null,
        status: VariantStatus.ACTIVE,
        ...(q === ''
          ? {}
          : {
              OR: [
                { skuCode: { contains: q, mode: 'insensitive' } },
                { variantLabel: { contains: q, mode: 'insensitive' } },
                { product: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }),
      },
      // The product first so a product's variants arrive together, then
      // the SKU, so the same query always returns the same order.
      orderBy: [{ product: { name: 'asc' } }, { skuCode: 'asc' }],
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        skuCode: true,
        variantLabel: true,
        productId: true,
        product: { select: { name: true } },
      },
    });
    if (rows.length === 0) return [];

    // One query for the whole result set — a type-ahead firing twenty
    // image lookups per keystroke would be worse than no pictures.
    const images = await this.prisma.client.productImage.findMany({
      where: { variantId: { in: rows.map((r) => r.id) }, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { variantId: true, spacesKey: true, thumbnailUrl: true },
    });
    const firstFor = new Map<string, (typeof images)[number]>();
    for (const img of images) {
      if (!firstFor.has(img.variantId)) firstFor.set(img.variantId, img);
    }

    return Promise.all(
      rows.map(async (r) => {
        const img = firstFor.get(r.id);
        const key =
          img === undefined
            ? null
            : ((img.thumbnailUrl !== null ? deriveThumbnailKey(img.spacesKey) : null) ??
              img.spacesKey);
        return {
          id: r.id,
          productId: r.productId,
          skuCode: r.skuCode,
          variantLabel: r.variantLabel,
          productName: r.product.name,
          primaryImageUrl: key === null ? null : await this.spaces.presignGetUrl(key),
        };
      }),
    );
  }

  async getById(sellerId: string, productId: string, variantId: string): Promise<VariantView> {
    const row = await this.prisma.client.productVariant.findFirst({
      where: { id: variantId, productId, sellerId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'Variant not found' });
    }
    return row;
  }

  async update(
    sellerId: string,
    productId: string,
    variantId: string,
    input: UpdateVariantDto,
    ctx: ClientContext,
  ): Promise<VariantView> {
    await this.requireProduct(sellerId, productId);
    await this.requireVariant(sellerId, productId, variantId);

    const data: Prisma.ProductVariantUpdateInput = {};
    const changes: Record<string, string | number | null | boolean> = {};

    if (input.attributes !== undefined) {
      data.attributes = input.attributes as Prisma.InputJsonValue;
      changes['attributes'] = 'updated';
    }
    if (input.skuCode !== undefined) {
      data.skuCode = input.skuCode;
      changes['skuCode'] = input.skuCode;
    }
    if (input.variantLabel !== undefined) {
      data.variantLabel = input.variantLabel;
      changes['variantLabel'] = input.variantLabel;
    }
    if (input.weightGrams !== undefined) {
      data.weightGrams = input.weightGrams;
      changes['weightGrams'] = input.weightGrams;
    }
    for (const k of ['lengthCm', 'widthCm', 'heightCm', 'declaredValueInr', 'gstRate'] as const) {
      if (input[k] !== undefined) {
        (data as Record<string, unknown>)[k] = dec(input[k]);
        changes[k] = input[k] ?? null;
      }
    }
    if (input.barcode !== undefined) {
      data.barcode = input.barcode;
      changes['barcode'] = input.barcode;
    }
    if (Object.keys(changes).length === 0) {
      return this.getById(sellerId, productId, variantId);
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.productVariant.update({
          where: { id: variantId },
          data,
          select: VIEW_SELECT,
        });
        await this.audit.log(
          {
            actorType: ActorType.SELLER,
            sellerId,
            action: 'catalog.variant.updated',
            entityType: 'product_variant',
            entityId: variantId,
            changes: changes as Prisma.InputJsonValue,
            metadata: {
              productId,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
              requestId: ctx.requestId,
            },
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      throw this.mapSkuConflict(err, input.skuCode ?? undefined);
    }
  }

  async archive(
    sellerId: string,
    productId: string,
    variantId: string,
    ctx: ClientContext,
  ): Promise<VariantView> {
    const v = await this.requireVariant(sellerId, productId, variantId);
    if (v.status === VariantStatus.ARCHIVED) {
      throw new BadRequestException({
        code: 'ALREADY_ARCHIVED',
        message: 'Variant is already archived',
      });
    }
    return this.setStatus(
      sellerId,
      variantId,
      VariantStatus.ARCHIVED,
      'catalog.variant.archived',
      ctx,
    );
  }

  async unarchive(
    sellerId: string,
    productId: string,
    variantId: string,
    ctx: ClientContext,
  ): Promise<VariantView> {
    const v = await this.requireVariant(sellerId, productId, variantId);
    if (v.status !== VariantStatus.ARCHIVED) {
      throw new BadRequestException({
        code: 'NOT_ARCHIVED',
        message: `Only ARCHIVED variants can be unarchived (current: ${v.status})`,
      });
    }
    return this.setStatus(
      sellerId,
      variantId,
      VariantStatus.ACTIVE,
      'catalog.variant.unarchived',
      ctx,
    );
  }

  async softDelete(
    sellerId: string,
    productId: string,
    variantId: string,
    ctx: ClientContext,
  ): Promise<void> {
    await this.requireVariant(sellerId, productId, variantId);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { deletedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.variant.deleted',
          entityType: 'product_variant',
          entityId: variantId,
          metadata: {
            productId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
    });
  }

  // ---------- internal ----------

  private async setStatus(
    sellerId: string,
    variantId: string,
    status: VariantStatus,
    action: string,
    ctx: ClientContext,
  ): Promise<VariantView> {
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.productVariant.update({
        where: { id: variantId },
        data: { status },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action,
          entityType: 'product_variant',
          entityId: variantId,
          metadata: {
            status,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });
  }

  private async requireProduct(sellerId: string, productId: string): Promise<{ id: string }> {
    const row = await this.prisma.client.product.findFirst({
      where: { id: productId, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    return row;
  }

  private async requireVariant(
    sellerId: string,
    productId: string,
    variantId: string,
  ): Promise<{ id: string; status: VariantStatus }> {
    const row = await this.prisma.client.productVariant.findFirst({
      where: { id: variantId, productId, sellerId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'Variant not found' });
    }
    return row;
  }

  private mapSkuConflict(err: unknown, skuCode: string | undefined): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({
        code: 'SKU_CODE_TAKEN',
        message: `You already have a variant with skuCode "${skuCode ?? ''}"`,
      });
    }
    return err;
  }
}
