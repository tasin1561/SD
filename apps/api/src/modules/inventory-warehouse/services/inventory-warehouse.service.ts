import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, BinType, Prisma, WarehouseStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type {
  CreateWarehouseDto,
  ListWarehousesQueryDto,
  UpdateWarehouseDto,
} from '../dto/warehouse.dto';
import type { CreateZoneDto, UpdateZoneDto } from '../dto/zone.dto';
import type { CreateBinDto, ListBinsQueryDto, UpdateBinDto } from '../dto/bin.dto';

export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  status: WarehouseStatus;
  countryCode: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ZoneView {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  pickOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BinView {
  id: string;
  warehouseId: string;
  zoneId: string;
  code: string;
  type: BinType;
  aisle: string | null;
  shelf: string | null;
  maxWeightKg: Prisma.Decimal | null;
  maxVolumeCm3: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}

const WAREHOUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  countryCode: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ZONE_SELECT = {
  id: true,
  warehouseId: true,
  code: true,
  name: true,
  pickOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const BIN_SELECT = {
  id: true,
  warehouseId: true,
  zoneId: true,
  code: true,
  type: true,
  aisle: true,
  shelf: true,
  maxWeightKg: true,
  maxVolumeCm3: true,
  createdAt: true,
  updatedAt: true,
} as const;

function dec(n: number | null | undefined): Prisma.Decimal | null {
  return n === null || n === undefined ? null : new Prisma.Decimal(n);
}

/**
 * Admin warehouse/zone/bin CRUD. Topology is staff-managed reference data;
 * every mutation is audited (ActorType.STAFF) inside the same transaction
 * as the write. Codes are immutable natural keys (warehouse code is
 * referenced by ops.default_warehouse_id; zone/bin codes appear on
 * pick lists). Soft-delete (deletedAt) for zones/bins, guarded so we never
 * orphan stock or strand bins under a deleted zone.
 */
@Injectable()
export class InventoryWarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly resolver: WarehouseResolverService,
  ) {}

  // ---------------- warehouses ----------------

  async listWarehouses(query: ListWarehousesQueryDto): Promise<WarehouseView[]> {
    const where: Prisma.WarehouseWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    return this.prisma.client.warehouse.findMany({
      where,
      orderBy: { code: 'asc' },
      select: WAREHOUSE_SELECT,
    });
  }

  async getWarehouse(id: string): Promise<WarehouseView> {
    const row = await this.prisma.client.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: WAREHOUSE_SELECT,
    });
    if (!row) {
      throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    }
    return row;
  }

  async createWarehouse(
    staffId: string,
    input: CreateWarehouseDto,
    ctx: ClientContext,
  ): Promise<WarehouseView> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.warehouse.create({
          data: {
            code: input.code,
            name: input.name,
            status: input.status ?? WarehouseStatus.ACTIVE,
            countryCode: input.countryCode ?? 'IN',
            timezone: input.timezone ?? 'Asia/Kolkata',
          },
          select: WAREHOUSE_SELECT,
        });
        await this.writeAudit(
          tx,
          staffId,
          'inventory.warehouse.created',
          'warehouse',
          row.id,
          ctx,
          {
            code: row.code,
            status: row.status,
          },
        );
        return row;
      });
    } catch (err) {
      throw this.mapCodeConflict(
        err,
        'WAREHOUSE_CODE_TAKEN',
        `Warehouse code "${input.code}" is already in use`,
      );
    }
  }

  async updateWarehouse(
    staffId: string,
    id: string,
    input: UpdateWarehouseDto,
    ctx: ClientContext,
  ): Promise<WarehouseView> {
    await this.getWarehouse(id);
    const data: Prisma.WarehouseUpdateInput = {};
    const changes: Record<string, string | null> = {};
    if (input.name !== undefined) {
      data.name = input.name;
      changes['name'] = input.name;
    }
    if (input.status !== undefined) {
      data.status = input.status;
      changes['status'] = input.status;
    }
    if (input.countryCode !== undefined) {
      data.countryCode = input.countryCode;
      changes['countryCode'] = input.countryCode;
    }
    if (input.timezone !== undefined) {
      data.timezone = input.timezone;
      changes['timezone'] = input.timezone;
    }
    if (Object.keys(changes).length === 0) return this.getWarehouse(id);

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.warehouse.update({ where: { id }, data, select: WAREHOUSE_SELECT });
      await this.writeAudit(
        tx,
        staffId,
        'inventory.warehouse.updated',
        'warehouse',
        id,
        ctx,
        {},
        changes,
      );
      return row;
    });
  }

  // ---------------- zones ----------------

  async listZones(warehouseId: string): Promise<ZoneView[]> {
    await this.resolver.requireWarehouse(warehouseId);
    return this.prisma.client.warehouseZone.findMany({
      where: { warehouseId, deletedAt: null },
      orderBy: [{ pickOrder: 'asc' }, { code: 'asc' }],
      select: ZONE_SELECT,
    });
  }

  async createZone(
    staffId: string,
    warehouseId: string,
    input: CreateZoneDto,
    ctx: ClientContext,
  ): Promise<ZoneView> {
    await this.resolver.requireWarehouse(warehouseId);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.warehouseZone.create({
          data: {
            warehouseId,
            code: input.code,
            name: input.name,
            pickOrder: input.pickOrder ?? 100,
            isActive: input.isActive ?? true,
          },
          select: ZONE_SELECT,
        });
        await this.writeAudit(
          tx,
          staffId,
          'inventory.zone.created',
          'warehouse_zone',
          row.id,
          ctx,
          {
            warehouseId,
            code: row.code,
          },
        );
        return row;
      });
    } catch (err) {
      throw this.mapCodeConflict(
        err,
        'ZONE_CODE_TAKEN',
        `Zone code "${input.code}" already exists in this warehouse`,
      );
    }
  }

  async updateZone(
    staffId: string,
    warehouseId: string,
    zoneId: string,
    input: UpdateZoneDto,
    ctx: ClientContext,
  ): Promise<ZoneView> {
    await this.requireZone(warehouseId, zoneId);
    const data: Prisma.WarehouseZoneUpdateInput = {};
    const changes: Record<string, string | number | boolean | null> = {};
    if (input.name !== undefined) {
      data.name = input.name;
      changes['name'] = input.name;
    }
    if (input.pickOrder !== undefined) {
      data.pickOrder = input.pickOrder;
      changes['pickOrder'] = input.pickOrder;
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
      changes['isActive'] = input.isActive;
    }
    if (Object.keys(changes).length === 0) return this.requireZone(warehouseId, zoneId);

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.warehouseZone.update({
        where: { id: zoneId },
        data,
        select: ZONE_SELECT,
      });
      await this.writeAudit(
        tx,
        staffId,
        'inventory.zone.updated',
        'warehouse_zone',
        zoneId,
        ctx,
        {},
        changes,
      );
      return row;
    });
  }

  async deleteZone(
    staffId: string,
    warehouseId: string,
    zoneId: string,
    ctx: ClientContext,
  ): Promise<void> {
    await this.requireZone(warehouseId, zoneId);
    const activeBins = await this.prisma.client.warehouseBin.count({
      where: { zoneId, deletedAt: null },
    });
    if (activeBins > 0) {
      throw new ConflictException({
        code: 'ZONE_HAS_BINS',
        message: `Zone has ${activeBins} active bin(s); delete or move them first`,
      });
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.warehouseZone.update({ where: { id: zoneId }, data: { deletedAt: new Date() } });
      await this.writeAudit(tx, staffId, 'inventory.zone.deleted', 'warehouse_zone', zoneId, ctx, {
        warehouseId,
      });
    });
  }

  // ---------------- bins ----------------

  async listBins(warehouseId: string, query: ListBinsQueryDto): Promise<BinView[]> {
    await this.resolver.requireWarehouse(warehouseId);
    const where: Prisma.WarehouseBinWhereInput = { warehouseId, deletedAt: null };
    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.type) where.type = query.type;
    return this.prisma.client.warehouseBin.findMany({
      where,
      orderBy: { code: 'asc' },
      select: BIN_SELECT,
    });
  }

  async createBin(
    staffId: string,
    warehouseId: string,
    input: CreateBinDto,
    ctx: ClientContext,
  ): Promise<BinView> {
    await this.resolver.requireWarehouse(warehouseId);
    await this.requireZone(warehouseId, input.zoneId);
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.warehouseBin.create({
          data: {
            warehouseId,
            zoneId: input.zoneId,
            code: input.code,
            type: input.type,
            aisle: input.aisle ?? null,
            shelf: input.shelf ?? null,
            maxWeightKg: dec(input.maxWeightKg),
            maxVolumeCm3: dec(input.maxVolumeCm3),
          },
          select: BIN_SELECT,
        });
        await this.writeAudit(tx, staffId, 'inventory.bin.created', 'warehouse_bin', row.id, ctx, {
          warehouseId,
          zoneId: input.zoneId,
          code: row.code,
          type: row.type,
        });
        return row;
      });
    } catch (err) {
      throw this.mapCodeConflict(
        err,
        'BIN_CODE_TAKEN',
        `Bin code "${input.code}" already exists in this warehouse`,
      );
    }
  }

  async updateBin(
    staffId: string,
    warehouseId: string,
    binId: string,
    input: UpdateBinDto,
    ctx: ClientContext,
  ): Promise<BinView> {
    await this.requireBin(warehouseId, binId);
    const data: Prisma.WarehouseBinUpdateInput = {};
    const changes: Record<string, string | number | null> = {};
    if (input.zoneId !== undefined) {
      // Moving zones: the new zone must live in the same warehouse.
      await this.requireZone(warehouseId, input.zoneId);
      data.zone = { connect: { id: input.zoneId } };
      changes['zoneId'] = input.zoneId;
    }
    if (input.type !== undefined) {
      data.type = input.type;
      changes['type'] = input.type;
    }
    if (input.aisle !== undefined) {
      data.aisle = input.aisle;
      changes['aisle'] = input.aisle;
    }
    if (input.shelf !== undefined) {
      data.shelf = input.shelf;
      changes['shelf'] = input.shelf;
    }
    if (input.maxWeightKg !== undefined) {
      data.maxWeightKg = dec(input.maxWeightKg);
      changes['maxWeightKg'] = input.maxWeightKg;
    }
    if (input.maxVolumeCm3 !== undefined) {
      data.maxVolumeCm3 = dec(input.maxVolumeCm3);
      changes['maxVolumeCm3'] = input.maxVolumeCm3;
    }
    if (Object.keys(changes).length === 0) return this.requireBin(warehouseId, binId);

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.warehouseBin.update({ where: { id: binId }, data, select: BIN_SELECT });
      await this.writeAudit(
        tx,
        staffId,
        'inventory.bin.updated',
        'warehouse_bin',
        binId,
        ctx,
        {},
        changes,
      );
      return row;
    });
  }

  async deleteBin(
    staffId: string,
    warehouseId: string,
    binId: string,
    ctx: ClientContext,
  ): Promise<void> {
    await this.requireBin(warehouseId, binId);
    // Never orphan stock: a bin holding any stock_levels row (qty or not)
    // or referenced by an ACTIVE reservation cannot be deleted.
    const [stockRows, activeResv] = await Promise.all([
      this.prisma.client.stockLevel.count({ where: { binId } }),
      this.prisma.client.stockReservation.count({ where: { binId, status: 'ACTIVE' } }),
    ]);
    if (stockRows > 0 || activeResv > 0) {
      throw new ConflictException({
        code: 'BIN_NOT_EMPTY',
        message: `Bin still has ${stockRows} stock-level row(s) and ${activeResv} active reservation(s); clear them first`,
      });
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.warehouseBin.update({ where: { id: binId }, data: { deletedAt: new Date() } });
      await this.writeAudit(tx, staffId, 'inventory.bin.deleted', 'warehouse_bin', binId, ctx, {
        warehouseId,
      });
    });
  }

  // ---------------- internal ----------------

  private async requireZone(warehouseId: string, zoneId: string): Promise<ZoneView> {
    const row = await this.prisma.client.warehouseZone.findFirst({
      where: { id: zoneId, warehouseId, deletedAt: null },
      select: ZONE_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Zone not found in this warehouse',
      });
    }
    return row;
  }

  private async requireBin(warehouseId: string, binId: string): Promise<BinView> {
    const row = await this.prisma.client.warehouseBin.findFirst({
      where: { id: binId, warehouseId, deletedAt: null },
      select: BIN_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'BIN_NOT_FOUND',
        message: 'Bin not found in this warehouse',
      });
    }
    return row;
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    staffId: string,
    action: string,
    entityType: string,
    entityId: string,
    ctx: ClientContext,
    metadata: Record<string, unknown>,
    changes?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.log(
      {
        actorType: ActorType.STAFF,
        staffUserId: staffId,
        action,
        entityType,
        entityId,
        changes: changes ? (changes as Prisma.InputJsonValue) : null,
        metadata: {
          ...metadata,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
        },
      },
      tx,
    );
  }

  private mapCodeConflict(err: unknown, code: string, message: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({ code, message });
    }
    if (
      err instanceof BadRequestException ||
      err instanceof NotFoundException ||
      err instanceof ConflictException
    ) {
      return err;
    }
    return err;
  }
}
