import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, AttributeValueType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { AttributeResolutionService } from './attribute-resolution.service';
import type { CreateAttributeDefinitionDto } from '../dto/create-attribute.dto';
import type { UpdateAttributeDefinitionDto } from '../dto/update-attribute.dto';

export interface AttributeDefinitionView {
  id: string;
  categoryId: string;
  attributeKey: string;
  displayLabel: string;
  valueType: AttributeValueType;
  allowedValues: string[];
  isRequired: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  categoryId: true,
  attributeKey: true,
  displayLabel: true,
  valueType: true,
  allowedValues: true,
  isRequired: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AttributeDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly resolution: AttributeResolutionService,
  ) {}

  /**
   * Bulk-create attribute definitions for a freshly created category
   * inside an existing transaction (used by category-proposal approval).
   * Validates ENUM-requires-values and rejects duplicate keys within the
   * input. No audit, no cache invalidation — the category is brand new so
   * nothing is cached, and the caller owns the surrounding audit.
   */
  async createManyInTx(
    tx: Prisma.TransactionClient,
    categoryId: string,
    defs: Array<{
      attributeKey: string;
      displayLabel: string;
      valueType: AttributeValueType;
      allowedValues?: string[];
      isRequired?: boolean;
      displayOrder?: number;
    }>,
  ): Promise<number> {
    if (defs.length === 0) return 0;
    const seen = new Set<string>();
    for (const d of defs) {
      if (seen.has(d.attributeKey)) {
        throw new ConflictException({
          code: 'DUPLICATE_ATTRIBUTE_KEY',
          message: `Duplicate attributeKey "${d.attributeKey}" in the attribute set`,
        });
      }
      seen.add(d.attributeKey);
      this.assertEnumHasValues(d.valueType, d.allowedValues);
    }
    await tx.categoryAttributeDefinition.createMany({
      data: defs.map((d) => ({
        categoryId,
        attributeKey: d.attributeKey,
        displayLabel: d.displayLabel,
        valueType: d.valueType,
        allowedValues: d.allowedValues ?? [],
        isRequired: d.isRequired ?? false,
        displayOrder: d.displayOrder ?? 100,
      })),
    });
    return defs.length;
  }

  /** Definitions declared directly on this category (NOT inherited — the
   *  inherited/effective set is resolved by the resolver in commit 6). */
  async listForCategory(categoryId: string): Promise<AttributeDefinitionView[]> {
    await this.requireCategory(categoryId);
    return this.prisma.client.categoryAttributeDefinition.findMany({
      where: { categoryId, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { attributeKey: 'asc' }],
      select: VIEW_SELECT,
    });
  }

  async create(
    categoryId: string,
    input: CreateAttributeDefinitionDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<AttributeDefinitionView> {
    await this.requireCategory(categoryId);
    this.assertEnumHasValues(input.valueType, input.allowedValues);

    const dup = await this.prisma.client.categoryAttributeDefinition.findFirst({
      where: { categoryId, attributeKey: input.attributeKey, deletedAt: null },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException({
        code: 'ATTRIBUTE_KEY_TAKEN',
        message: `Attribute "${input.attributeKey}" already exists on this category`,
      });
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.categoryAttributeDefinition.create({
        data: {
          categoryId,
          attributeKey: input.attributeKey,
          displayLabel: input.displayLabel,
          valueType: input.valueType,
          allowedValues: input.allowedValues ?? [],
          isRequired: input.isRequired ?? false,
          displayOrder: input.displayOrder ?? 100,
        },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          action: 'catalog.attribute_definition.created',
          entityType: 'category_attribute_definition',
          entityId: row.id,
          metadata: {
            categoryId,
            attributeKey: row.attributeKey,
            valueType: row.valueType,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });
    await this.resolution.invalidate(categoryId);
    return created;
  }

  async update(
    categoryId: string,
    attributeId: string,
    input: UpdateAttributeDefinitionDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<AttributeDefinitionView> {
    const existing = await this.prisma.client.categoryAttributeDefinition.findFirst({
      where: { id: attributeId, categoryId, deletedAt: null },
      select: { id: true, valueType: true, allowedValues: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'ATTRIBUTE_NOT_FOUND',
        message: 'Attribute definition not found',
      });
    }

    const effectiveType = input.valueType ?? existing.valueType;
    const effectiveValues =
      input.allowedValues ?? existing.allowedValues;
    this.assertEnumHasValues(effectiveType, effectiveValues);

    const data: Prisma.CategoryAttributeDefinitionUpdateInput = {};
    const changes: Record<string, string | boolean | number | string[]> = {};
    if (input.displayLabel !== undefined) {
      data.displayLabel = input.displayLabel;
      changes['displayLabel'] = input.displayLabel;
    }
    if (input.valueType !== undefined) {
      data.valueType = input.valueType;
      changes['valueType'] = input.valueType;
    }
    if (input.allowedValues !== undefined) {
      data.allowedValues = input.allowedValues;
      changes['allowedValues'] = input.allowedValues;
    }
    if (input.isRequired !== undefined) {
      data.isRequired = input.isRequired;
      changes['isRequired'] = input.isRequired;
    }
    if (input.displayOrder !== undefined) {
      data.displayOrder = input.displayOrder;
      changes['displayOrder'] = input.displayOrder;
    }
    if (Object.keys(changes).length === 0) {
      return this.requireAttribute(categoryId, attributeId);
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.categoryAttributeDefinition.update({
        where: { id: attributeId },
        data,
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          action: 'catalog.attribute_definition.updated',
          entityType: 'category_attribute_definition',
          entityId: attributeId,
          changes: changes as Prisma.InputJsonValue,
          metadata: {
            categoryId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });
    await this.resolution.invalidate(categoryId);
    return updated;
  }

  async softDelete(
    categoryId: string,
    attributeId: string,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<{ deleted: true; warning?: string }> {
    const existing = await this.prisma.client.categoryAttributeDefinition.findFirst({
      where: { id: attributeId, categoryId, deletedAt: null },
      select: { id: true, attributeKey: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'ATTRIBUTE_NOT_FOUND',
        message: 'Attribute definition not found',
      });
    }
    // Phase 1A: we do NOT block deletion when variants already carry this
    // attribute key (tracked in phase-1a-debt). Historical variant
    // attribute JSON is preserved as-is; future variant writes simply stop
    // requiring/validating the removed key. We surface a soft warning if
    // the category has products (a cheap proxy for "variants may carry
    // this key") — no deep scan of variant.attributes JSON.
    const productCount = await this.prisma.client.product.count({
      where: { categoryId, deletedAt: null },
    });

    await this.prisma.client.$transaction(async (tx) => {
      await tx.categoryAttributeDefinition.update({
        where: { id: attributeId },
        data: { deletedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          action: 'catalog.attribute_definition.deleted',
          entityType: 'category_attribute_definition',
          entityId: attributeId,
          metadata: {
            categoryId,
            attributeKey: existing.attributeKey,
            productCount,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
    });
    await this.resolution.invalidate(categoryId);

    if (productCount > 0) {
      return {
        deleted: true,
        warning:
          `This attribute was on a category with ${productCount} product(s). ` +
          `Existing variants may still reference '${existing.attributeKey}' in ` +
          `their attributes JSON. Historical data is preserved.`,
      };
    }
    return { deleted: true };
  }

  // ---------- internal ----------

  private assertEnumHasValues(
    valueType: AttributeValueType,
    allowedValues: string[] | undefined,
  ): void {
    if (valueType === AttributeValueType.ENUM && (!allowedValues || allowedValues.length === 0)) {
      throw new BadRequestException({
        code: 'ENUM_REQUIRES_VALUES',
        message: 'allowedValues must be a non-empty array when valueType is ENUM',
      });
    }
  }

  private async requireCategory(categoryId: string): Promise<void> {
    const cat = await this.prisma.client.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!cat) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }
  }

  private async requireAttribute(
    categoryId: string,
    attributeId: string,
  ): Promise<AttributeDefinitionView> {
    const row = await this.prisma.client.categoryAttributeDefinition.findFirst({
      where: { id: attributeId, categoryId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ATTRIBUTE_NOT_FOUND',
        message: 'Attribute definition not found',
      });
    }
    return row;
  }
}
