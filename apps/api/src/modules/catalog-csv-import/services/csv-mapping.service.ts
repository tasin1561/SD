import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, CsvImportType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { isCsvTargetField, type CsvTargetField } from '../csv-fields';
import type { CreateCsvMappingDto, UpdateCsvMappingDto } from '../dto/csv-mapping.dto';

export interface CsvMappingView {
  id: string;
  name: string;
  importType: CsvImportType;
  columnMap: Partial<Record<CsvTargetField, string>>;
  isDefault: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  name: true,
  importType: true,
  columnMap: true,
  isDefault: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface MappingRow {
  id: string;
  name: string;
  importType: CsvImportType;
  columnMap: Prisma.JsonValue;
  isDefault: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CsvMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Validate + normalize a raw columnMap into `catalog field -> header`.
   * Rejects unknown target-field keys and non-string header values; an
   * empty map is rejected (a saved mapping with nothing mapped is useless).
   */
  private sanitizeColumnMap(raw: Record<string, unknown>): Partial<Record<CsvTargetField, string>> {
    const out: Partial<Record<CsvTargetField, string>> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isCsvTargetField(key)) {
        throw new BadRequestException({
          code: 'UNKNOWN_MAPPING_FIELD',
          message: `columnMap key "${key}" is not a known catalog field`,
        });
      }
      if (typeof value !== 'string' || value.trim() === '') {
        throw new BadRequestException({
          code: 'INVALID_MAPPING_HEADER',
          message: `columnMap["${key}"] must be a non-empty header string`,
        });
      }
      out[key] = value;
    }
    if (Object.keys(out).length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_MAPPING',
        message: 'columnMap must map at least one field',
      });
    }
    return out;
  }

  async create(
    sellerId: string,
    input: CreateCsvMappingDto,
    ctx: ClientContext,
  ): Promise<CsvMappingView> {
    const importType = input.importType ?? CsvImportType.PRODUCT_VARIANT;
    const columnMap = this.sanitizeColumnMap(input.columnMap);
    const makeDefault = input.isDefault === true;

    const row = await this.prisma.client.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.sellerCsvMapping.updateMany({
          where: { sellerId, importType, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      const created = await tx.sellerCsvMapping.create({
        data: {
          sellerId,
          name: input.name,
          importType,
          columnMap: columnMap as Prisma.InputJsonValue,
          isDefault: makeDefault,
        },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.csv_mapping.created',
          entityType: 'seller_csv_mapping',
          entityId: created.id,
          metadata: {
            name: created.name,
            importType,
            isDefault: makeDefault,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return created;
    });
    return this.toView(row);
  }

  async list(sellerId: string, importType?: CsvImportType): Promise<CsvMappingView[]> {
    const where: Prisma.SellerCsvMappingWhereInput = {
      sellerId,
      deletedAt: null,
    };
    if (importType) where.importType = importType;
    const rows = await this.prisma.client.sellerCsvMapping.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: VIEW_SELECT,
    });
    return rows.map((r) => this.toView(r));
  }

  async getById(sellerId: string, id: string): Promise<CsvMappingView> {
    return this.toView(await this.requireMapping(sellerId, id));
  }

  async update(
    sellerId: string,
    id: string,
    input: UpdateCsvMappingDto,
    ctx: ClientContext,
  ): Promise<CsvMappingView> {
    const existing = await this.requireMapping(sellerId, id);

    const data: Prisma.SellerCsvMappingUpdateInput = {};
    const changes: Record<string, string | boolean | null> = {};
    if (input.name !== undefined) {
      data.name = input.name;
      changes['name'] = input.name;
    }
    if (input.columnMap !== undefined) {
      const sanitized = this.sanitizeColumnMap(input.columnMap);
      data.columnMap = sanitized as Prisma.InputJsonValue;
      changes['columnMap'] = JSON.stringify(sanitized);
    }
    const makeDefault = input.isDefault;
    if (makeDefault !== undefined) {
      data.isDefault = makeDefault;
      changes['isDefault'] = makeDefault;
    }
    if (Object.keys(changes).length === 0) {
      return this.toView(existing);
    }

    const row = await this.prisma.client.$transaction(async (tx) => {
      if (makeDefault === true) {
        await tx.sellerCsvMapping.updateMany({
          where: {
            sellerId,
            importType: existing.importType,
            isDefault: true,
            deletedAt: null,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      const updated = await tx.sellerCsvMapping.update({
        where: { id },
        data,
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.csv_mapping.updated',
          entityType: 'seller_csv_mapping',
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
      return updated;
    });
    return this.toView(row);
  }

  async softDelete(sellerId: string, id: string, ctx: ClientContext): Promise<void> {
    await this.requireMapping(sellerId, id);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.sellerCsvMapping.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.csv_mapping.deleted',
          entityType: 'seller_csv_mapping',
          entityId: id,
          metadata: {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
    });
  }

  /**
   * Resolve a saved mapping's columnMap for use by preview/process. Returns
   * `null` if the id is absent (caller falls back to auto-detection). Throws
   * 404 if a non-null id does not belong to the seller — a stale/foreign id
   * must not silently degrade to auto-detect.
   */
  async resolveColumnMap(
    sellerId: string,
    mappingId: string,
  ): Promise<Partial<Record<CsvTargetField, string>>> {
    const row = await this.requireMapping(sellerId, mappingId);
    return this.coerceColumnMap(row.columnMap);
  }

  /** Bump lastUsedAt when a saved mapping actually drives an import. */
  async markUsed(sellerId: string, mappingId: string): Promise<void> {
    await this.prisma.client.sellerCsvMapping.updateMany({
      where: { id: mappingId, sellerId, deletedAt: null },
      data: { lastUsedAt: new Date() },
    });
  }

  private async requireMapping(sellerId: string, id: string): Promise<MappingRow> {
    const row = await this.prisma.client.sellerCsvMapping.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'CSV_MAPPING_NOT_FOUND',
        message: 'Saved CSV mapping not found',
      });
    }
    return row;
  }

  private coerceColumnMap(raw: Prisma.JsonValue): Partial<Record<CsvTargetField, string>> {
    const out: Partial<Record<CsvTargetField, string>> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (isCsvTargetField(key) && typeof value === 'string') {
          out[key] = value;
        }
      }
    }
    return out;
  }

  private toView(row: MappingRow): CsvMappingView {
    return {
      id: row.id,
      name: row.name,
      importType: row.importType,
      columnMap: this.coerceColumnMap(row.columnMap),
      isDefault: row.isDefault,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
