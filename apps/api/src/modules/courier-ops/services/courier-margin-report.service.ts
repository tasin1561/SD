import { Injectable } from '@nestjs/common';
import { ChargeType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DelhiveryMarginReconciliationService } from '../../courier-delhivery/services/delhivery-margin-reconciliation.service';
import { ShipmentCourierContextService } from './shipment-courier-context.service';

export interface MarginRow {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly orderId: string | null;
  readonly lane: string;
  readonly billedToSellerInr: string;
  readonly actualCourierCostInr: string;
  readonly marginInr: string;
  readonly marginPercent: string;
  readonly lossMaking: boolean;
  readonly assumedCostInr: string | null;
  readonly assumptionDriftInr: string | null;
}

export interface MarginReport {
  readonly generatedAt: Date;
  readonly sampledShipments: number;
  readonly totalBilledInr: string;
  readonly totalActualCostInr: string;
  readonly totalMarginInr: string;
  readonly lossMakingCount: number;
  readonly rows: readonly MarginRow[];
  readonly skipped: readonly { shipmentId: string; reason: string }[];
}

const ZERO = new Prisma.Decimal(0);

/**
 * The charge types that make up "what we billed for carrying this
 * parcel", listed explicitly rather than as "everything except GST".
 *
 * GST is out because the courier's cost figure we compare against is
 * pre-tax; mixing the two would move every margin by 18% for no real
 * reason. ADJUSTMENT and REFUND are out because they are corrections to
 * a past bill, not the price of this carriage. RTO_FEE and
 * RESHIPMENT_FEE are out because they price a SECOND movement — folding
 * them in would make a returned parcel look profitable.
 */
const SHIPPING_CHARGE_TYPES = [
  ChargeType.BASE_SHIPPING,
  ChargeType.COD_FEE,
  ChargeType.FUEL_SURCHARGE,
  ChargeType.REMOTE_AREA_FEE,
  ChargeType.WEIGHT_DISPUTE_FEE,
] as const;

/**
 * What we charged versus what the courier actually charged us.
 *
 * R1 wired margin against `RateCardItem.costToSkydropInr` — a number
 * somebody typed in. That makes "margin" the gap between what we bill
 * and what we ASSUMED it costs, which is a hope rather than a
 * measurement. Delhivery's invoice-charges API returns the real figure,
 * so this report produces the honest version.
 *
 * ── WHY THIS IS SAMPLED, NOT EXHAUSTIVE ──────────────────────────────
 * Each row costs one live call to Delhivery, and their WAF answers 403
 * — blocking our whole egress IP — when a budget is exhausted. Pricing
 * every shipment ever dispatched would take the live traffic down with
 * it. So the caller names a window and a cap, the report says how many
 * it actually priced, and anything skipped is listed with its reason
 * rather than silently dropped. A report that quietly covered 40 of 400
 * shipments would read as a complete picture.
 *
 * ── IT NEVER CHANGES ANYTHING ────────────────────────────────────────
 * No rate card is adjusted, no charge is rewritten, no wallet moves.
 * Repricing is a commercial decision, and one made off a single lane's
 * reading would be a bad one.
 */
@Injectable()
export class CourierMarginReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: ShipmentCourierContextService,
    private readonly reconciliation: DelhiveryMarginReconciliationService,
  ) {}

  async report(input: {
    from: Date;
    to: Date;
    limit: number;
  }): Promise<MarginReport> {
    const originPin = await this.context.originPin();
    const skipped: { shipmentId: string; reason: string }[] = [];

    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        isManualCourier: false,
        awbNumber: { not: null },
        createdAt: { gte: input.from, lte: input.to },
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        destPostalCode: true,
        totalWeightGrams: true,
        declaredWeightGrams: true,
        chargeableWeightGrams: true,
        codAmountInr: true,
        orderShipments: { select: { orderId: true }, take: 1 },
      },
    });

    if (originPin === null) {
      return {
        generatedAt: new Date(),
        sampledShipments: 0,
        totalBilledInr: '0.00',
        totalActualCostInr: '0.00',
        totalMarginInr: '0.00',
        lossMakingCount: 0,
        rows: [],
        skipped: shipments.map((s) => ({
          shipmentId: s.id,
          reason:
            'Origin pincode is not configured (courier.delhivery_origin_pincode), so no lane can be priced.',
        })),
      };
    }

    const rows: MarginRow[] = [];
    let totalBilled = ZERO;
    let totalActual = ZERO;

    // Sequential on purpose: this is the rate-budgeted endpoint, and
    // firing the whole page at once is what trips the WAF.
    for (const s of shipments) {
      const orderId = s.orderShipments[0]?.orderId ?? null;
      if (orderId === null) {
        skipped.push({ shipmentId: s.id, reason: 'No linked order.' });
        continue;
      }

      const billed = await this.billedShipping(orderId);
      if (billed === null) {
        skipped.push({
          shipmentId: s.id,
          reason:
            'No shipping charges persisted for the order, so there is nothing to compare the cost against.',
        });
        continue;
      }

      try {
        const check = await this.reconciliation.check({
          originPin,
          destinationPin: s.destPostalCode,
          chargeableWeightGrams:
            s.chargeableWeightGrams ??
            s.declaredWeightGrams ??
            s.totalWeightGrams,
          isCod: s.codAmountInr !== null && s.codAmountInr.greaterThan(0),
          billedToSellerInr: billed.toString(),
        });
        rows.push({
          shipmentId: s.id,
          shipmentNumber: s.shipmentNumber,
          awbNumber: s.awbNumber,
          orderId,
          lane: check.lane,
          billedToSellerInr: check.billedToSellerInr,
          actualCourierCostInr: check.actualCourierCostInr,
          marginInr: check.marginInr,
          marginPercent: check.marginPercent,
          lossMaking: check.lossMaking,
          assumedCostInr: check.assumedCostInr,
          assumptionDriftInr: check.assumptionDriftInr,
        });
        totalBilled = totalBilled.add(billed);
        totalActual = totalActual.add(
          new Prisma.Decimal(check.actualCourierCostInr),
        );
      } catch (err) {
        skipped.push({
          shipmentId: s.id,
          reason: err instanceof Error ? err.message : 'Cost lookup failed.',
        });
      }
    }

    return {
      generatedAt: new Date(),
      sampledShipments: rows.length,
      totalBilledInr: totalBilled.toFixed(2),
      totalActualCostInr: totalActual.toFixed(2),
      totalMarginInr: totalBilled.sub(totalActual).toFixed(2),
      lossMakingCount: rows.filter((r) => r.lossMaking).length,
      rows,
      skipped,
    };
  }

  /**
   * What the seller was billed for shipping on this order.
   *
   * Base shipping plus its surcharges, EXCLUDING tax: the courier's cost
   * figure we compare against is pre-tax on the same basis, and mixing
   * the two would flatter or damn the margin by 18% for no real reason.
   */
  private async billedShipping(orderId: string): Promise<Prisma.Decimal | null> {
    const charges = await this.prisma.client.orderCharge.findMany({
      where: {
        orderId,
        deletedAt: null,
        type: { in: [...SHIPPING_CHARGE_TYPES] },
      },
      select: { totalAmountInr: true },
    });
    if (charges.length === 0) return null;
    return charges.reduce(
      (sum, c) => sum.add(c.totalAmountInr),
      new Prisma.Decimal(0),
    );
  }
}
