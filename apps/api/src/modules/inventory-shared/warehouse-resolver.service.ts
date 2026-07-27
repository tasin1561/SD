import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { WarehouseStatus } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** system_settings key holding the BLR-01 (Phase 1A single-warehouse) uuid. */
const DEFAULT_WAREHOUSE_SETTING_KEY = 'ops.default_warehouse_id';

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  status: WarehouseStatus;
}

/**
 * Resolves "which warehouse" for inventory operations.
 *
 * Locked decision #6: inventory services take a strict `warehouseId`;
 * only seller-facing controllers aggregate across warehouses. This service
 * is the one place where "no warehouse specified" becomes "the configured
 * default", and where a caller-supplied id is validated to exist.
 *
 * A mis-seeded / dangling `ops.default_warehouse_id` is an operational
 * misconfiguration, not a client error — it surfaces as 500 with a clear
 * code, never as a confusing 404 to a seller.
 */
@Injectable()
export class WarehouseResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The configured default warehouse id, verified to point at a live
   * (non-soft-deleted) warehouse. Throws if unset or dangling.
   */
  async getDefaultWarehouseId(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: DEFAULT_WAREHOUSE_SETTING_KEY },
      select: { valueString: true },
    });
    const id = row?.valueString?.trim();
    if (!id) {
      throw new InternalServerErrorException({
        code: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: `${DEFAULT_WAREHOUSE_SETTING_KEY} is not set`,
      });
    }
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!wh) {
      throw new InternalServerErrorException({
        code: 'DEFAULT_WAREHOUSE_INVALID',
        message: `${DEFAULT_WAREHOUSE_SETTING_KEY} points to a missing or deleted warehouse`,
      });
    }
    return wh.id;
  }

  /**
   * Caller-supplied id wins (validated for existence); otherwise the
   * configured default. Use at the controller/service boundary to turn an
   * optional request param into the strict id the inner services require.
   */
  async resolveWarehouseId(explicitId?: string | null): Promise<string> {
    if (explicitId) {
      const wh = await this.requireWarehouse(explicitId);
      return wh.id;
    }
    return this.getDefaultWarehouseId();
  }

  /** A non-soft-deleted warehouse, or 404. */
  async requireWarehouse(id: string): Promise<WarehouseRef> {
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, code: true, name: true, status: true },
    });
    if (!wh) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Warehouse not found',
      });
    }
    return wh;
  }
}
