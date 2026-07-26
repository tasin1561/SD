import { Injectable } from '@nestjs/common';
import { StockUnitStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';

export interface StuckUnitRow {
  readonly stockUnitId: string;
  readonly serialBarcode: string;
  readonly variantId: string;
  readonly skuCode: string | null;
  readonly status: StockUnitStatus;
  readonly warehouseId: string;
  readonly hoursInStatus: number;
  readonly lastScanAt: Date | null;
  readonly shipmentId: string | null;
}

export interface UnitCountMismatchRow {
  readonly variantId: string;
  readonly skuCode: string | null;
  readonly warehouseId: string;
  readonly unitsInStock: number;
  readonly qtyOnHand: number;
  readonly delta: number;
}

export interface UnitDiscrepancyReport {
  readonly sellerId: string;
  readonly generatedAt: Date;
  readonly thresholds: {
    readonly stuckSlaHours: number;
    readonly dispatchedUnresolvedDays: number;
  };
  /** Units sitting mid-lifecycle (PICKED / PACKED) past the SLA — an
   *  expected scan that never happened. */
  readonly stuckUnits: readonly StuckUnitRow[];
  /** DISPATCHED longer than the window with no RTO — never confirmed
   *  delivered, never came back. */
  readonly unresolvedDispatched: readonly StuckUnitRow[];
  /** Units retired as LOST or WRITTEN_OFF — the "missing / damaged
   *  barcode" list, so a supervisor can chase or bill them. */
  readonly retiredUnits: readonly StuckUnitRow[];
  /** Where the unit ledger and the authoritative aggregate disagree.
   *  Surfaced, never auto-corrected. */
  readonly countMismatches: readonly UnitCountMismatchRow[];
}

const STUCK_STATUSES: readonly StockUnitStatus[] = [
  StockUnitStatus.PICKED,
  StockUnitStatus.PACKED,
];

/**
 * R4 — the discovery tool. Read-only: it NEVER writes a unit, a movement
 * or a stock level.
 *
 * The whole point is that strict mode does not pretend the floor is
 * perfect. `stock_levels.qtyOnHand` stays authoritative (INV-3); the unit
 * ledger is the enforcement + evidence layer. When the two disagree — a
 * unit that was never scanned at pack, a parcel that vanished after
 * dispatch, a serial nobody can find — this report is where it shows up,
 * as a number a supervisor acts on rather than a silent auto-correction
 * that would destroy the evidence.
 */
@Injectable()
export class StockUnitReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  async forSeller(
    sellerId: string,
    opts: { warehouseId?: string } = {},
  ): Promise<UnitDiscrepancyReport> {
    const [stuckSlaHours, dispatchedUnresolvedDays] = await Promise.all([
      this.intSetting(sellerId, 'inventory.unit_stuck_sla_hours', 48),
      this.intSetting(sellerId, 'inventory.unit_dispatched_unresolved_days', 30),
    ]);

    const now = new Date();
    const stuckBefore = new Date(now.getTime() - stuckSlaHours * 3600_000);
    const dispatchedBefore = new Date(
      now.getTime() - dispatchedUnresolvedDays * 86_400_000,
    );
    const warehouseFilter =
      opts.warehouseId === undefined ? {} : { warehouseId: opts.warehouseId };

    const [stuck, dispatched, retired] = await Promise.all([
      this.prisma.client.stockUnit.findMany({
        where: {
          sellerId,
          ...warehouseFilter,
          status: { in: [...STUCK_STATUSES] },
          updatedAt: { lt: stuckBefore },
        },
        select: UNIT_SELECT,
        orderBy: { updatedAt: 'asc' },
        take: 500,
      }),
      this.prisma.client.stockUnit.findMany({
        where: {
          sellerId,
          ...warehouseFilter,
          status: StockUnitStatus.DISPATCHED,
          updatedAt: { lt: dispatchedBefore },
        },
        select: UNIT_SELECT,
        orderBy: { updatedAt: 'asc' },
        take: 500,
      }),
      this.prisma.client.stockUnit.findMany({
        where: {
          sellerId,
          ...warehouseFilter,
          status: { in: [StockUnitStatus.LOST, StockUnitStatus.WRITTEN_OFF] },
        },
        select: UNIT_SELECT,
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
    ]);

    return {
      sellerId,
      generatedAt: now,
      thresholds: { stuckSlaHours, dispatchedUnresolvedDays },
      stuckUnits: stuck.map((u) => this.toRow(u, now)),
      unresolvedDispatched: dispatched.map((u) => this.toRow(u, now)),
      retiredUnits: retired.map((u) => this.toRow(u, now)),
      countMismatches: await this.countMismatches(sellerId, opts.warehouseId),
    };
  }

  /**
   * The load-bearing reconciliation: for every (variant, warehouse) that
   * has serialized units, compare `COUNT(units IN_STOCK)` against the
   * authoritative `SUM(qtyOnHand)`. A non-zero delta is a real floor
   * event (a unit physically present but never registered, or registered
   * and then lost without a write-off), so it is reported, not fixed.
   */
  async countMismatches(
    sellerId: string,
    warehouseId?: string,
  ): Promise<readonly UnitCountMismatchRow[]> {
    const grouped = await this.prisma.client.stockUnit.groupBy({
      by: ['variantId', 'warehouseId'],
      where: {
        sellerId,
        status: StockUnitStatus.IN_STOCK,
        ...(warehouseId === undefined ? {} : { warehouseId }),
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];

    const skuByVariant = await this.skuCodes(grouped.map((g) => g.variantId));
    const rows: UnitCountMismatchRow[] = [];
    for (const g of grouped) {
      // qtyOnHand (NOT availability): the comparison is physical units
      // present vs physical units booked. Reservations are a claim on
      // stock that is still on the shelf, so they must not enter here.
      const agg = await this.prisma.client.stockLevel.aggregate({
        where: {
          sellerId,
          variantId: g.variantId,
          warehouseId: g.warehouseId,
        },
        _sum: { qtyOnHand: true },
      });
      const qtyOnHand = agg._sum.qtyOnHand ?? 0;
      const unitsInStock = g._count._all;
      const delta = unitsInStock - qtyOnHand;
      if (delta !== 0) {
        rows.push({
          variantId: g.variantId,
          skuCode: skuByVariant.get(g.variantId) ?? null,
          warehouseId: g.warehouseId,
          unitsInStock,
          qtyOnHand,
          delta,
        });
      }
    }
    return rows;
  }

  /** Full scan history for one serial — "where has this unit been?" */
  async trace(
    sellerId: string,
    serialBarcode: string,
  ): Promise<{
    unit: StuckUnitRow | null;
    events: ReadonlyArray<{
      toStatus: StockUnitStatus;
      fromStatus: StockUnitStatus | null;
      gate: string;
      at: Date;
      shipmentId: string | null;
      note: string | null;
    }>;
  }> {
    const unit = await this.prisma.client.stockUnit.findUnique({
      where: { sellerId_serialBarcode: { sellerId, serialBarcode } },
      select: {
        ...UNIT_SELECT,
        events: {
          select: {
            fromStatus: true,
            toStatus: true,
            gate: true,
            createdAt: true,
            shipmentId: true,
            note: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!unit) return { unit: null, events: [] };
    return {
      unit: this.toRow(unit, new Date()),
      events: unit.events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        gate: e.gate,
        at: e.createdAt,
        shipmentId: e.shipmentId,
        note: e.note,
      })),
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  private toRow(
    u: {
      id: string;
      serialBarcode: string;
      variantId: string;
      status: StockUnitStatus;
      warehouseId: string;
      updatedAt: Date;
      lastScanAt: Date | null;
      variant: { skuCode: string } | null;
      shipmentItem: { shipmentId: string } | null;
    },
    now: Date,
  ): StuckUnitRow {
    return {
      stockUnitId: u.id,
      serialBarcode: u.serialBarcode,
      variantId: u.variantId,
      skuCode: u.variant?.skuCode ?? null,
      status: u.status,
      warehouseId: u.warehouseId,
      hoursInStatus:
        Math.round(((now.getTime() - u.updatedAt.getTime()) / 3600_000) * 10) / 10,
      lastScanAt: u.lastScanAt,
      shipmentId: u.shipmentItem?.shipmentId ?? null,
    };
  }

  private async skuCodes(variantIds: string[]): Promise<Map<string, string>> {
    const variants = await this.prisma.client.productVariant.findMany({
      where: { id: { in: [...new Set(variantIds)] } },
      select: { id: true, skuCode: true },
    });
    return new Map(variants.map((v) => [v.id, v.skuCode]));
  }

  private async intSetting(
    sellerId: string,
    key: string,
    fallback: number,
  ): Promise<number> {
    try {
      const resolved = await this.settings.resolve(sellerId, key);
      const n = Number(resolved.value);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    } catch {
      return fallback;
    }
  }
}

const UNIT_SELECT = {
  id: true,
  serialBarcode: true,
  variantId: true,
  status: true,
  warehouseId: true,
  updatedAt: true,
  lastScanAt: true,
  variant: { select: { skuCode: true } },
  shipmentItem: { select: { shipmentId: true } },
} as const;
