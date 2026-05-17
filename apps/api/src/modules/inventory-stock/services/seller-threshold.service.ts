import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { StockCacheService } from '../../inventory-shared/stock-cache.service';

export interface AlertConfigView {
  defaultLowStockThreshold: number | null;
}

export interface VariantThresholdView {
  variantId: string;
  productId: string;
  lowStockThreshold: number | null;
}

/**
 * Seller-managed low-stock thresholds. `lowStockThreshold` is an
 * inventory-owned scalar that physically lives on product_variants;
 * ownership/existence is validated through the sanctioned
 * CatalogReadService boundary (no direct product_variants READ — CLAUDE
 * MUST #13), and only the single inventory-owned column is written. Any
 * threshold change busts the seller's display caches (isLowStock is
 * derived from the threshold) across all warehouses.
 */
@Injectable()
export class SellerThresholdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly catalog: CatalogReadService,
    private readonly cache: StockCacheService,
  ) {}

  async getAlertConfig(sellerId: string): Promise<AlertConfigView> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { defaultLowStockThreshold: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }
    return { defaultLowStockThreshold: seller.defaultLowStockThreshold };
  }

  async setDefaultThreshold(
    sellerId: string,
    value: number | null,
    ctx: ClientContext,
  ): Promise<AlertConfigView> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const seller = await tx.seller.findFirst({
        where: { id: sellerId, deletedAt: null },
        select: { id: true, defaultLowStockThreshold: true },
      });
      if (!seller) {
        throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
      }
      await tx.seller.update({
        where: { id: sellerId },
        data: { defaultLowStockThreshold: value },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'inventory.threshold.default_updated',
          entityType: 'seller',
          entityId: sellerId,
          changes: {
            defaultLowStockThreshold: { from: seller.defaultLowStockThreshold, to: value },
          },
          metadata: {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return { defaultLowStockThreshold: value };
    });
    await this.invalidateAllWarehouses(sellerId);
    return result;
  }

  async setVariantThreshold(
    sellerId: string,
    productId: string,
    variantId: string,
    value: number | null,
    ctx: ClientContext,
  ): Promise<VariantThresholdView> {
    // Sanctioned read boundary: confirms the variant exists, is this
    // seller's, and belongs to the path's product.
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

    await this.prisma.client.$transaction(async (tx) => {
      // Inventory writes ONLY its own scalar on the variant row — this is
      // not a cross-module catalog read (MUST #13 governs reads).
      await tx.productVariant.update({
        where: { id: variantId },
        data: { lowStockThreshold: value },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'inventory.threshold.variant_updated',
          entityType: 'product_variant',
          entityId: variantId,
          changes: {
            lowStockThreshold: { from: variant.lowStockThreshold, to: value },
          },
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
    await this.invalidateAllWarehouses(sellerId);
    return { variantId, productId, lowStockThreshold: value };
  }

  // ---------- internal ----------

  /** A threshold change flips isLowStock in the cached snapshots — bust
   *  every (seller, warehouse) pair. */
  private async invalidateAllWarehouses(sellerId: string): Promise<void> {
    const warehouses = await this.prisma.client.warehouse.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    await Promise.all(
      warehouses.map((w) => this.cache.invalidate(sellerId, w.id)),
    );
  }
}
