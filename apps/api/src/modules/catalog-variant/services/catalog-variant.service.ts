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

export interface VariantView {
  id: string;
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
  hsCode: string | null;
  gstRate: Prisma.Decimal | null;
  barcode: string | null;
  externalSku: string | null;
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
  hsCode: true,
  gstRate: true,
  barcode: true,
  externalSku: true,
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
            hsCode: input.hsCode ?? null,
            gstRate: dec(input.gstRate),
            barcode: input.barcode ?? null,
            externalSku: input.externalSku ?? null,
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
    return this.prisma.client.productVariant.findMany({
      where: { productId, sellerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: VIEW_SELECT,
    });
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
    if (input.hsCode !== undefined) {
      data.hsCode = input.hsCode;
      changes['hsCode'] = input.hsCode;
    }
    if (input.barcode !== undefined) {
      data.barcode = input.barcode;
      changes['barcode'] = input.barcode;
    }
    if (input.externalSku !== undefined) {
      data.externalSku = input.externalSku;
      changes['externalSku'] = input.externalSku;
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
