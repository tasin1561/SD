import { Injectable, NotFoundException } from '@nestjs/common';
import type { BinType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { NON_PICKABLE_BIN_TYPES } from '../../inventory-shared/bin-policy.service';
import {
  StockReadService,
  type BinStockLineRaw,
  type BinStockTotals,
} from '../../inventory-stock/services/stock-read.service';

/**
 * Lines shown inline under each bin on the all-bins view. A bin holding
 * more says how many are not shown and links to its own paged page.
 */
export const LINES_PER_BIN = 50;

/**
 * When every bin together holds at most this many lines, the overview
 * reads them in ONE query and caps per bin in memory. Above it, it asks
 * each non-empty bin for its first LINES_PER_BIN — one small indexed query
 * per bin with stock — so one enormous FLOOR bin cannot crowd every other
 * bin out of a single capped read.
 */
export const ONE_QUERY_LINE_LIMIT = 2000;

export interface BinStockLine {
  stockLevelId: string;
  sellerId: string;
  /** Company name; null only if the seller row is gone. */
  sellerName: string | null;
  variantId: string;
  /** Null when the variant or its product is soft-deleted (the stock is still real). */
  productName: string | null;
  /** Presigned at read time (catalog rule 5b); null when there is no picture. */
  thumbnailUrl: string | null;
  skuCode: string | null;
  variantLabel: string | null;
  batchId: string;
  batchCode: string;
  batchExpiresAt: Date | null;
  qtyOnHand: number;
  /** Phase-2 (INV-4): allocated to a pick on this bin. */
  qtyReserved: number;
}

export interface BinWithLines {
  id: string;
  code: string;
  type: BinType;
  zoneCode: string | null;
  pickable: boolean;
  unitsOnHand: number;
  unitsReserved: number;
  skuCount: number;
  lineCount: number;
  lines: BinStockLine[];
  /** lineCount − lines.length; open the bin to see them. */
  linesNotShown: number;
}

export interface WarehouseWithBins {
  id: string;
  code: string;
  name: string;
  binTrackingEnabled: boolean;
  fulfilsOrders: boolean;
  bins: BinWithLines[];
}

export interface BinOverview {
  warehouses: WarehouseWithBins[];
  linesPerBin: number;
}

export interface BinContentsPage {
  bin: Omit<BinWithLines, 'lines' | 'linesNotShown'> & {
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
  };
  items: Array<BinStockLine & { lastMovementAt: Date | null }>;
  total: number;
  page: number;
  pageSize: number;
}

const EMPTY_TOTALS = { unitsOnHand: 0, unitsReserved: 0, skuCount: 0, lineCount: 0 };

/**
 * "What is in each bin" — read-only, for the admin bins page.
 *
 * Stock comes through `StockReadService` (the inventory-stock read
 * surface); product names through `CatalogReadService` in ONE batched call
 * (MUST #13); seller names in ONE query. Nothing here writes stock or is
 * read by anything that decides — it is a display (INV-2).
 */
@Injectable()
export class BinContentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockReadService,
    private readonly catalog: CatalogReadService,
  ) {}

  /** Every live warehouse, every live bin, and each bin's lines (capped). */
  async overview(): Promise<BinOverview> {
    const warehouses = await this.prisma.client.warehouse.findMany({
      where: { deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, binTrackingEnabled: true, fulfilsOrders: true },
    });
    const bins = await this.prisma.client.warehouseBin.findMany({
      where: { deletedAt: null, warehouseId: { in: warehouses.map((w) => w.id) } },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        warehouseId: true,
        code: true,
        type: true,
        zone: { select: { code: true } },
      },
    });

    const totals = await this.stock.binTotalsForDisplay(bins.map((b) => b.id));
    const raw = await this.readLines(totals);
    const lines = await this.enrich(raw);

    const byBin = new Map<string, BinStockLine[]>();
    raw.forEach((r, i) => {
      const line = lines[i];
      if (line === undefined) return;
      const list = byBin.get(r.binId) ?? [];
      if (list.length < LINES_PER_BIN) list.push(line);
      byBin.set(r.binId, list);
    });

    return {
      linesPerBin: LINES_PER_BIN,
      warehouses: warehouses.map((w) => ({
        ...w,
        bins: bins
          .filter((b) => b.warehouseId === w.id)
          .map((b) => {
            const t = totals.get(b.id) ?? { binId: b.id, ...EMPTY_TOTALS };
            const shown = byBin.get(b.id) ?? [];
            return {
              id: b.id,
              code: b.code,
              type: b.type,
              zoneCode: b.zone.code,
              pickable: !NON_PICKABLE_BIN_TYPES.includes(b.type),
              unitsOnHand: t.unitsOnHand,
              unitsReserved: t.unitsReserved,
              skuCount: t.skuCount,
              lineCount: t.lineCount,
              lines: shown,
              linesNotShown: Math.max(0, t.lineCount - shown.length),
            };
          }),
      })),
    };
  }

  /** One bin, paged, with when each line last moved in it. */
  async binContents(
    binId: string,
    q: { page?: number; pageSize?: number },
  ): Promise<BinContentsPage> {
    const bin = await this.prisma.client.warehouseBin.findFirst({
      where: { id: binId, deletedAt: null },
      select: {
        id: true,
        code: true,
        type: true,
        zone: { select: { code: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });
    if (bin === null) {
      throw new NotFoundException({ code: 'BIN_NOT_FOUND', message: 'Bin not found' });
    }
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const totals = await this.stock.binTotalsForDisplay([bin.id]);
    const t = totals.get(bin.id) ?? { binId: bin.id, ...EMPTY_TOTALS };
    const raw = await this.stock.binLinesForDisplay([bin.id], {
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    const [lines, lastMoved] = await Promise.all([
      this.enrich(raw),
      this.stock.binLastMovementForDisplay(
        bin.id,
        raw.map((r) => r.variantId),
      ),
    ]);

    return {
      bin: {
        id: bin.id,
        code: bin.code,
        type: bin.type,
        zoneCode: bin.zone.code,
        pickable: !NON_PICKABLE_BIN_TYPES.includes(bin.type),
        unitsOnHand: t.unitsOnHand,
        unitsReserved: t.unitsReserved,
        skuCount: t.skuCount,
        lineCount: t.lineCount,
        warehouseId: bin.warehouse.id,
        warehouseCode: bin.warehouse.code,
        warehouseName: bin.warehouse.name,
      },
      items: lines.map((l) => ({
        ...l,
        lastMovementAt: lastMoved.get(`${l.variantId}|${l.batchId}`) ?? null,
      })),
      total: t.lineCount,
      page,
      pageSize,
    };
  }

  // ---------- internal ----------

  private async readLines(totals: ReadonlyMap<string, BinStockTotals>): Promise<BinStockLineRaw[]> {
    const stocked = [...totals.values()].filter((t) => t.lineCount > 0);
    if (stocked.length === 0) return [];
    const all = stocked.reduce((n, t) => n + t.lineCount, 0);
    if (all <= ONE_QUERY_LINE_LIMIT) {
      return this.stock.binLinesForDisplay(
        stocked.map((t) => t.binId),
        { take: all },
      );
    }
    const perBin = await Promise.all(
      stocked.map((t) => this.stock.binLinesForDisplay([t.binId], { take: LINES_PER_BIN })),
    );
    return perBin.flat();
  }

  /** Names for a set of lines: one catalog call, one seller query. Same order out. */
  private async enrich(raw: readonly BinStockLineRaw[]): Promise<BinStockLine[]> {
    if (raw.length === 0) return [];
    const variantIds = raw.map((r) => r.variantId);
    const [variants, thumbs, sellers] = await Promise.all([
      this.catalog.getVariantsByIds(variantIds),
      // A picture lookup that fails costs the picture, never the screen.
      this.catalog
        .thumbnailUrlsByVariant(variantIds)
        .catch((): ReadonlyMap<string, string> => new Map()),
      this.prisma.client.seller.findMany({
        where: { id: { in: [...new Set(raw.map((r) => r.sellerId))] } },
        select: { id: true, companyName: true },
      }),
    ]);
    const sellerName = new Map(sellers.map((s) => [s.id, s.companyName]));
    return raw.map((r) => {
      const v = variants.get(r.variantId);
      return {
        stockLevelId: r.stockLevelId,
        sellerId: r.sellerId,
        sellerName: sellerName.get(r.sellerId) ?? null,
        variantId: r.variantId,
        productName: v?.productName ?? null,
        thumbnailUrl: thumbs.get(r.variantId) ?? null,
        skuCode: v?.skuCode ?? null,
        variantLabel: v?.variantLabel ?? null,
        batchId: r.batchId,
        batchCode: r.batchCode,
        batchExpiresAt: r.batchExpiresAt,
        qtyOnHand: r.qtyOnHand,
        qtyReserved: r.qtyReserved,
      };
    });
  }
}
