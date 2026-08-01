import { Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NON_PICKABLE_BIN_TYPES } from './bin-policy.service';

/**
 * Availability counts only stock a picker could actually reach.
 *
 * This predicate MUST stay identical to the one
 * `StockPickAllocationService` applies when it hunts for a bin. They are
 * both expressed from `NON_PICKABLE_BIN_TYPES` for that reason.
 *
 * When they disagreed, the failure was quiet and expensive: a return
 * restocked into RTO_HOLD raised `qtyOnHand`, availability counted it,
 * the seller saw sellable stock, an order confirmed and reserved against
 * it — and then pick allocation refused to touch the bin, shortfalled,
 * and WMS-4 fail-routed the order to PENDING_MANUAL_PLACEMENT. The order
 * did not fail where it was placed; it failed on the warehouse floor.
 */
function pickableLevelFilter(): Prisma.StockLevelWhereInput {
  // A fresh object each call: Prisma's generated `notIn` wants a mutable
  // array, so a shared `as const` literal cannot be spread into a where.
  return { bin: { type: { notIn: [...NON_PICKABLE_BIN_TYPES] }, deletedAt: null } };
}

export interface ComputeAvailabilityInput {
  sellerId: string;
  variantId: string;
  warehouseId: string;
  /** Optional tx so a caller already inside a stock transaction reads the
   *  same isolation boundary. Defaults to the singleton client. */
  tx?: Prisma.TransactionClient | undefined;
}

export interface ComputeBulkAvailabilityInput {
  sellerId: string;
  variantIds: string[];
  warehouseId: string;
  tx?: Prisma.TransactionClient | undefined;
}

/**
 * INV-3 availability primitive — the single sanctioned place that turns
 * raw stock rows into the COMPUTED `qtyAvailable` scalar:
 *
 *   qtyAvailable = SUM(stock_levels.qtyOnHand WHERE bin is pickable)
 *                − SUM(stock_reservations.qtyReserved WHERE status=ACTIVE)
 *
 * over one (seller, variant, warehouse). The bin-type filter is the part
 * that keeps this honest — see pickableLevelFilter above. Goods in a
 * hold, damaged or quarantine bin are on hand but not for sale, and
 * saying otherwise promises a customer something no picker can fetch.
 *
 * ACTIVE reservations count
 * uniformly (phase-1 floating + phase-2 allocated). No cache, no writes,
 * no side effects — a pure read. Lives in inventory-shared so any
 * inventory-* module (and the cross-module read/reservation/alert paths)
 * can derive availability without depending on StockReadService.
 *
 * Returns a CLAMPED non-negative number (`Math.max(0, …)`): a transient
 * over-reservation can drive the raw difference negative, but "available"
 * is never meaningfully below zero. For diagnostic visibility of the
 * negative (over-reserved) state, use
 * StockReadService.getVariantStockLive() which preserves the unclamped
 * { qtyOnHand, qtyReservedActive, qtyAvailable } breakdown.
 *
 * INV-2 still applies to *callers*: this is a live DB read (never the
 * display cache), so mutation/decision paths may use it; seller-facing
 * display reads go through StockReadService's cache-backed surface.
 */
@Injectable()
export class StockAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Live, clamped availability for one (seller, variant, warehouse). */
  async compute(input: ComputeAvailabilityInput): Promise<number> {
    const db = input.tx ?? this.prisma.client;
    const { sellerId, variantId, warehouseId } = input;
    const [onHand, reserved] = await Promise.all([
      db.stockLevel.aggregate({
        where: { sellerId, variantId, warehouseId, ...pickableLevelFilter() },
        _sum: { qtyOnHand: true },
      }),
      db.stockReservation.aggregate({
        where: { sellerId, variantId, warehouseId, status: 'ACTIVE' },
        _sum: { qtyReserved: true },
      }),
    ]);
    const qtyOnHand = onHand._sum.qtyOnHand ?? 0;
    const qtyReservedActive = reserved._sum.qtyReserved ?? 0;
    return Math.max(0, qtyOnHand - qtyReservedActive);
  }

  /**
   * Bulk variant of compute() — two GROUP BY queries, never N+1. Every
   * requested variantId is present in the result Map (0 when it has no
   * stock/reservation footprint), so callers can index without a guard.
   */
  async computeBulk(input: ComputeBulkAvailabilityInput): Promise<Map<string, number>> {
    const db = input.tx ?? this.prisma.client;
    const { sellerId, variantIds, warehouseId } = input;
    const result = new Map<string, number>();
    for (const id of variantIds) result.set(id, 0);
    if (variantIds.length === 0) return result;

    const [levels, reservations] = await Promise.all([
      db.stockLevel.groupBy({
        by: ['variantId'],
        where: {
          sellerId,
          warehouseId,
          variantId: { in: variantIds },
          ...pickableLevelFilter(),
        },
        _sum: { qtyOnHand: true },
      }),
      db.stockReservation.groupBy({
        by: ['variantId'],
        where: {
          sellerId,
          warehouseId,
          status: 'ACTIVE',
          variantId: { in: variantIds },
        },
        _sum: { qtyReserved: true },
      }),
    ]);

    const onHandByVariant = new Map<string, number>();
    for (const l of levels) onHandByVariant.set(l.variantId, l._sum.qtyOnHand ?? 0);
    const reservedByVariant = new Map<string, number>();
    for (const r of reservations) {
      reservedByVariant.set(r.variantId, r._sum.qtyReserved ?? 0);
    }
    for (const id of variantIds) {
      const onHand = onHandByVariant.get(id) ?? 0;
      const reserved = reservedByVariant.get(id) ?? 0;
      result.set(id, Math.max(0, onHand - reserved));
    }
    return result;
  }
}
