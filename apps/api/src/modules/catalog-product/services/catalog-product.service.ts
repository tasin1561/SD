import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Prisma, ProductStatus, VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { CreateProductDto } from '../dto/create-product.dto';
import type { UpdateProductDto } from '../dto/update-product.dto';
import type { ListProductsQueryDto } from '../dto/list-products.dto';

export interface ProductView {
  id: string;
  sellerId: string;
  name: string;
  description: string | null;
  externalRef: string | null;
  defaultWeightGrams: number | null;
  defaultLengthCm: Prisma.Decimal | null;
  defaultWidthCm: Prisma.Decimal | null;
  defaultHeightCm: Prisma.Decimal | null;
  defaultDeclaredValueInr: Prisma.Decimal | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  sellerId: true,
  name: true,
  description: true,
  externalRef: true,
  defaultWeightGrams: true,
  defaultLengthCm: true,
  defaultWidthCm: true,
  defaultHeightCm: true,
  defaultDeclaredValueInr: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function dec(n: number | null | undefined): Prisma.Decimal | null {
  return n === null || n === undefined ? null : new Prisma.Decimal(n);
}

@Injectable()
export class CatalogProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async create(
    sellerId: string,
    input: CreateProductDto,
    ctx: ClientContext,
  ): Promise<ProductView> {
    const status =
      input.status === ProductStatus.DRAFT ? ProductStatus.DRAFT : ProductStatus.ACTIVE;

    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.product.create({
          data: {
            sellerId,
            name: input.name,
            description: input.description ?? null,
            externalRef: input.externalRef ?? null,
            defaultWeightGrams: input.defaultWeightGrams ?? null,
            defaultLengthCm: dec(input.defaultLengthCm),
            defaultWidthCm: dec(input.defaultWidthCm),
            defaultHeightCm: dec(input.defaultHeightCm),
            defaultDeclaredValueInr: dec(input.defaultDeclaredValueInr),
            status,
          },
          select: VIEW_SELECT,
        });
        await this.audit.log(
          {
            actorType: ActorType.SELLER,
            sellerId,
            action: 'catalog.product.created',
            entityType: 'product',
            entityId: row.id,
            metadata: {
              externalRef: row.externalRef,
              status: row.status,
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
      throw this.mapExternalRefConflict(err, input.externalRef);
    }
  }

  async list(
    sellerId: string,
    query: ListProductsQueryDto,
  ): Promise<{ items: ProductView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ProductWhereInput = { sellerId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { externalRef: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.client.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: VIEW_SELECT,
      }),
      this.prisma.client.product.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getById(sellerId: string, id: string): Promise<ProductView> {
    const row = await this.prisma.client.product.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    return row;
  }

  async update(
    sellerId: string,
    id: string,
    input: UpdateProductDto,
    ctx: ClientContext,
  ): Promise<ProductView> {
    await this.requireProduct(sellerId, id);

    const data: Prisma.ProductUpdateInput = {};
    const changes: Record<string, string | number | null> = {};
    const setStr = (k: keyof UpdateProductDto, modelKey: keyof Prisma.ProductUpdateInput): void => {
      const v = input[k];
      if (v === undefined) return;
      (data as Record<string, unknown>)[modelKey as string] = v;
      changes[modelKey as string] = (v as string | number | null) ?? null;
    };
    setStr('name', 'name');
    setStr('description', 'description');
    setStr('externalRef', 'externalRef');
    if (input.defaultWeightGrams !== undefined) {
      data.defaultWeightGrams = input.defaultWeightGrams;
      changes['defaultWeightGrams'] = input.defaultWeightGrams;
    }
    for (const k of [
      'defaultLengthCm',
      'defaultWidthCm',
      'defaultHeightCm',
      'defaultDeclaredValueInr',
    ] as const) {
      if (input[k] !== undefined) {
        (data as Record<string, unknown>)[k] = dec(input[k]);
        changes[k] = input[k] ?? null;
      }
    }
    if (Object.keys(changes).length === 0) {
      return this.getById(sellerId, id);
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.product.update({ where: { id }, data, select: VIEW_SELECT });
        await this.audit.log(
          {
            actorType: ActorType.SELLER,
            sellerId,
            action: 'catalog.product.updated',
            entityType: 'product',
            entityId: id,
            changes: changes as Prisma.InputJsonValue,
            metadata: {
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
      throw this.mapExternalRefConflict(err, input.externalRef ?? undefined);
    }
  }

  /** Archiving a product cascades to ARCHIVE all its (non-deleted) variants. */
  async archive(sellerId: string, id: string, ctx: ClientContext): Promise<ProductView> {
    const product = await this.requireProduct(sellerId, id);
    if (product.status === ProductStatus.ARCHIVED) {
      throw new BadRequestException({
        code: 'ALREADY_ARCHIVED',
        message: 'Product is already archived',
      });
    }
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id },
        data: { status: ProductStatus.ARCHIVED },
        select: VIEW_SELECT,
      });
      const { count } = await tx.productVariant.updateMany({
        where: { productId: id, deletedAt: null, status: { not: VariantStatus.ARCHIVED } },
        data: { status: VariantStatus.ARCHIVED },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.product.archived',
          entityType: 'product',
          entityId: id,
          metadata: {
            variantsArchived: count,
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

  /** Unarchive sets the product ACTIVE but does NOT touch variants —
   *  re-activating variants is a separate explicit action. */
  async unarchive(sellerId: string, id: string, ctx: ClientContext): Promise<ProductView> {
    const product = await this.requireProduct(sellerId, id);
    if (product.status !== ProductStatus.ARCHIVED) {
      throw new BadRequestException({
        code: 'NOT_ARCHIVED',
        message: `Only ARCHIVED products can be unarchived (current: ${product.status})`,
      });
    }
    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id },
        data: { status: ProductStatus.ACTIVE },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.product.unarchived',
          entityType: 'product',
          entityId: id,
          metadata: {
            note: 'variants left as-is (explicit re-activation required)',
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

  /** Soft-deleting a product soft-deletes all its variants (cascade). */
  async softDelete(sellerId: string, id: string, ctx: ClientContext): Promise<void> {
    await this.requireProduct(sellerId, id);
    await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      await tx.product.update({ where: { id }, data: { deletedAt: now } });
      const { count } = await tx.productVariant.updateMany({
        where: { productId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.product.deleted',
          entityType: 'product',
          entityId: id,
          metadata: {
            variantsDeleted: count,
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

  private async requireProduct(
    sellerId: string,
    id: string,
  ): Promise<{ id: string; status: ProductStatus }> {
    const row = await this.prisma.client.product.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    return row;
  }

  private mapExternalRefConflict(err: unknown, externalRef: string | undefined): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({
        code: 'EXTERNAL_REF_TAKEN',
        message: `You already have a product with externalRef "${externalRef ?? ''}"`,
      });
    }
    return err;
  }
}
