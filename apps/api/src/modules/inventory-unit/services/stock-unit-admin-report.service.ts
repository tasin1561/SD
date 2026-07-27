import { Injectable } from '@nestjs/common';
import { SellerStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { StockUnitReportService } from './stock-unit-report.service';

export interface SellerDiscrepancySummary {
  readonly sellerId: string;
  readonly companyName: string | null;
  readonly stuckUnits: number;
  readonly unresolvedDispatched: number;
  readonly countMismatches: number;
  /** The three above. Retired units are excluded — see the class doc. */
  readonly needsAttention: number;
  readonly thresholds: {
    readonly stuckSlaHours: number;
    readonly dispatchedUnresolvedDays: number;
  };
}

export interface DiscrepancyTriage {
  readonly generatedAt: Date;
  /** Sellers with at least one serialized unit, worst first. */
  readonly sellers: readonly SellerDiscrepancySummary[];
  readonly totalNeedsAttention: number;
  /** True when more sellers hold serialized stock than were examined. */
  readonly truncated: boolean;
  readonly examined: number;
}

/**
 * How many sellers were swept in one pass. Each one costs a handful of
 * queries, and this is an ops triage page rather than a hot path — but
 * an unbounded loop over every seller who ever held a serial is the kind
 * of thing that is fine until it is not.
 */
const MAX_SELLERS = 50;

/**
 * The admin's cross-seller view of serialized-unit discrepancies.
 *
 * The seller-facing report answers "what is wrong with MY stock". An
 * operations person has a different question — **"whose stock do I need
 * to look at today?"** — and cannot ask the seller report, because it
 * needs a sellerId they do not yet know.
 *
 * So this sweeps every seller holding serialized stock and returns a
 * ranked summary. Drilling in then reuses the seller report unchanged,
 * which matters: the number an operator sees on the detail page is
 * computed by exactly the same code the seller sees, so the two can
 * never quietly disagree during a support conversation.
 *
 * **Per-seller thresholds are honoured, not averaged.** "Stuck" means
 * past THAT seller's SLA (`inventory.unit_stuck_sla_hours`, which is
 * overridable). Sweeping with one global threshold would be cheaper by a
 * few queries and would misreport every seller who has customised it.
 *
 * **Retired units are excluded from `needsAttention`.** A written-off or
 * lost unit is a settled fact — it belongs on the report as history, but
 * it is not work. Counting it would mean a seller's queue never reaches
 * zero, and a number that never reaches zero stops being read.
 */
@Injectable()
export class StockUnitAdminReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: StockUnitReportService,
  ) {}

  async triage(opts: { warehouseId?: string } = {}): Promise<DiscrepancyTriage> {
    // Only sellers who actually hold serialized stock — a NORMAL-mode
    // seller has nothing to reconcile and would just be a zero row.
    const grouped = await this.prisma.client.stockUnit.groupBy({
      by: ['sellerId'],
      ...(opts.warehouseId === undefined ? {} : { where: { warehouseId: opts.warehouseId } }),
      _count: { _all: true },
    });

    const sellerIds = grouped.map((g) => g.sellerId);
    const examined = sellerIds.slice(0, MAX_SELLERS);

    const sellers = await this.prisma.client.seller.findMany({
      where: { id: { in: examined }, status: { not: SellerStatus.REJECTED } },
      select: { id: true, companyName: true },
    });
    const nameById = new Map(sellers.map((s) => [s.id, s.companyName]));

    const summaries: SellerDiscrepancySummary[] = [];
    for (const sellerId of examined) {
      const report = await this.reports.forSeller(
        sellerId,
        opts.warehouseId === undefined ? {} : { warehouseId: opts.warehouseId },
      );
      const needsAttention =
        report.stuckUnits.length +
        report.unresolvedDispatched.length +
        report.countMismatches.length;
      summaries.push({
        sellerId,
        companyName: nameById.get(sellerId) ?? null,
        stuckUnits: report.stuckUnits.length,
        unresolvedDispatched: report.unresolvedDispatched.length,
        countMismatches: report.countMismatches.length,
        needsAttention,
        thresholds: report.thresholds,
      });
    }

    // Worst first — a triage list sorted by seller name is a directory,
    // not a queue.
    summaries.sort((a, b) => b.needsAttention - a.needsAttention);

    return {
      generatedAt: new Date(),
      sellers: summaries,
      totalNeedsAttention: summaries.reduce((n, s) => n + s.needsAttention, 0),
      truncated: sellerIds.length > examined.length,
      examined: examined.length,
    };
  }
}
