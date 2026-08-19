import { Injectable, NotFoundException } from '@nestjs/common';
import { BinType, VariantStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StockReadService } from './stock-read.service';
import type { CachedVariantStock } from '../../inventory-shared/stock-cache.service';

export interface AggregatedVariantStock extends CachedVariantStock {
  /** How many warehouses contribute a stock footprint for this variant. */
  warehouseCount: number;
  /**
   * On hand, really the seller's, and sellable from NOWHERE yet: sitting
   * in a warehouse that does not fulfil orders (our Bangladesh intake),
   * or in a TRANSIT bin between two of ours.
   *
   * Kept OUT of qtyOnHand / qtyAvailable rather than folded in. Summed
   * together, a seller in Dhaka with 301 units and nothing in India was
   * told 301 were available to sell — they would have taken orders
   * against stock in another country, and every one would have failed at
   * confirmation.
   */
  qtyInTransit: number;
}

export interface AggregatedStockList {
  items: AggregatedVariantStock[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AggregatedStockSummary {
  totalSkus: number;
  totalQtyOnHand: number;
  totalQtyReserved: number;
  totalQtyAvailable: number;
  /** On hand somewhere it cannot be sold from — see qtyInTransit. */
  totalQtyInTransit: number;
  lowStockSkus: number;
}

/**
 * Seller-facing aggregation ACROSS warehouses. The inner StockReadService
 * is strictly per-warehouse (locked decision #6); this is the sanctioned
 * place that fans out over the seller's warehouses and merges, so the
 * controller stays thin. All reads are display reads (cache-backed inside
 * StockReadService).
 *
 * Note: isLowStock here is recomputed against the SUMMED cross-warehouse
 * availability (the seller's whole-network picture). Operational low-stock
 * ALERTING (StockAlertService) is deliberately per-(seller,variant,
 * warehouse) — a different, intentional grain.
 */
@Injectable()
export class SellerStockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockRead: StockReadService,
  ) {}

  async list(
    sellerId: string,
    opts: { status?: VariantStatus; page?: number; pageSize?: number },
  ): Promise<AggregatedStockList> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const merged = await this.merged(sellerId, { status: opts.status });
    const rows = [...merged.values()].sort((a, b) => a.skuCode.localeCompare(b.skuCode));
    const items = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return { items, total: rows.length, page, pageSize };
  }

  async summary(sellerId: string): Promise<AggregatedStockSummary> {
    const merged = await this.merged(sellerId, {});
    const rows = [...merged.values()];
    return {
      totalSkus: rows.length,
      totalQtyOnHand: rows.reduce((s, v) => s + v.qtyOnHand, 0),
      totalQtyReserved: rows.reduce((s, v) => s + v.qtyReserved, 0),
      totalQtyAvailable: rows.reduce((s, v) => s + v.qtyAvailable, 0),
      totalQtyInTransit: rows.reduce((s, v) => s + v.qtyInTransit, 0),
      lowStockSkus: rows.filter((v) => v.isLowStock).length,
    };
  }

  async byVariant(sellerId: string, variantId: string): Promise<AggregatedVariantStock> {
    const merged = await this.merged(sellerId, {});
    const hit = merged.get(variantId);
    if (hit) return hit;
    // No footprint anywhere — fall back to a zeroed view if it's the
    // seller's variant (any warehouse will resolve catalog metadata),
    // else 404.
    const whId = await this.firstWarehouseId();
    const zero = whId
      ? await this.stockRead.getVariantStockForDisplay(sellerId, variantId, whId)
      : null;
    if (!zero) {
      throw new NotFoundException({
        code: 'VARIANT_STOCK_NOT_FOUND',
        message: 'No stock record for this variant',
      });
    }
    return { ...zero, warehouseCount: 0, qtyInTransit: 0 };
  }

  // ---------- internal ----------

  private async merged(
    sellerId: string,
    opts: { status?: VariantStatus | undefined },
  ): Promise<Map<string, AggregatedVariantStock>> {
    // SELLABLE warehouses only. Stock in an intake-only site is on hand
    // and really the seller's, but it cannot ship from there — summing it
    // into the same number told a seller with 301 units in Dhaka and none
    // in India that 301 were available.
    const { fulfilling, intakeOnly } = await this.warehousesByRole();
    const out = new Map<string, AggregatedVariantStock>();
    for (const whId of fulfilling) {
      const rows = await this.stockRead.getDisplayVariants(sellerId, whId, opts);
      for (const r of rows) {
        const acc = out.get(r.variantId);
        if (!acc) {
          out.set(r.variantId, { ...r, warehouseCount: 1, qtyInTransit: 0 });
        } else {
          acc.qtyOnHand += r.qtyOnHand;
          acc.qtyReserved += r.qtyReserved;
          acc.qtyAvailable += r.qtyAvailable;
          acc.warehouseCount += 1;
        }
      }
    }

    // Everything on hand that is not sellable from where it stands: an
    // intake-only warehouse, or a TRANSIT bin in a fulfilling one. A
    // variant seen ONLY here still gets a row — otherwise a seller whose
    // whole consignment is in Dhaka sees an empty inventory page and
    // concludes their stock has been lost.
    const notSellable = await this.notSellableByVariant(sellerId, fulfilling, intakeOnly);
    for (const [variantId, qty] of notSellable) {
      const acc = out.get(variantId);
      if (acc) {
        acc.qtyInTransit += qty;
      } else {
        const shell = await this.shellFor(sellerId, variantId, fulfilling[0] ?? intakeOnly[0]);
        if (shell) out.set(variantId, { ...shell, warehouseCount: 0, qtyInTransit: qty });
      }
    }
    // Recompute isLowStock against the SUMMED availability (threshold is a
    // per-variant constant, identical across warehouses).
    for (const v of out.values()) {
      v.isLowStock = v.lowStockThreshold !== null && v.qtyAvailable < v.lowStockThreshold;
    }
    return out;
  }

  /**
   * The two kinds of building, kept apart.
   *
   * `fulfilsOrders` is the fact; this is the one place the seller-facing
   * aggregate asks about it (CNS-2).
   */
  private async warehousesByRole(): Promise<{ fulfilling: string[]; intakeOnly: string[] }> {
    const rows = await this.prisma.client.warehouse.findMany({
      where: { deletedAt: null },
      select: { id: true, fulfilsOrders: true },
      orderBy: { code: 'asc' },
    });
    return {
      fulfilling: rows.filter((r) => r.fulfilsOrders).map((r) => r.id),
      intakeOnly: rows.filter((r) => !r.fulfilsOrders).map((r) => r.id),
    };
  }

  /**
   * Per variant, what is on hand somewhere it cannot be sold from:
   * everything in an intake-only warehouse, plus anything sitting in a
   * TRANSIT bin of a fulfilling one (goods in the air between two of
   * ours, which are equally not for sale).
   */
  private async notSellableByVariant(
    sellerId: string,
    fulfilling: string[],
    intakeOnly: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.client.stockLevel.groupBy({
      by: ['variantId'],
      where: {
        sellerId,
        qtyOnHand: { gt: 0 },
        OR: [
          ...(intakeOnly.length > 0 ? [{ warehouseId: { in: intakeOnly } }] : []),
          ...(fulfilling.length > 0
            ? [{ warehouseId: { in: fulfilling }, bin: { type: BinType.TRANSIT } }]
            : []),
        ],
      },
      _sum: { qtyOnHand: true },
    });
    return new Map(rows.map((r) => [r.variantId, r._sum.qtyOnHand ?? 0]));
  }

  /** A zeroed display row, for a variant seen only where it cannot sell. */
  private async shellFor(
    sellerId: string,
    variantId: string,
    anyWarehouseId: string | undefined,
  ): Promise<CachedVariantStock | null> {
    if (anyWarehouseId === undefined) return null;
    return this.stockRead.getVariantStockForDisplay(sellerId, variantId, anyWarehouseId);
  }

  private async warehouseIds(): Promise<string[]> {
    const rows = await this.prisma.client.warehouse.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  private async firstWarehouseId(): Promise<string | null> {
    const ids = await this.warehouseIds();
    return ids[0] ?? null;
  }
}
