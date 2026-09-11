import { ShiprocketClientService } from '../../courier-shiprocket/services/shiprocket-client.service';
import { Injectable } from '@nestjs/common';
import { ChargeType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  DelhiveryMarginReconciliationService,
  type MarginCheck,
} from '../../courier-delhivery/services/delhivery-margin-reconciliation.service';
import { ShipmentCourierContextService } from './shipment-courier-context.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

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
    private readonly shiprocket: ShiprocketClientService,
  ) {}

  async report(
    staffId: string,
    input: { from: Date; to: Date; limit: number },
  ): Promise<MarginReport> {
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
        courierCode: true,
        courierAccountId: true,
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

      const isCod = s.codAmountInr !== null && s.codAmountInr.greaterThan(0);
      const weightGrams = s.chargeableWeightGrams ?? s.declaredWeightGrams ?? s.totalWeightGrams;

      try {
        // ── PRICE IT AGAINST THE COURIER THAT CARRIED IT ─────────────
        // This swept every non-manual shipment and asked Delhivery what
        // each one cost, which was correct while there was one courier
        // and became a money error the moment there were two: a
        // Shiprocket parcel's "actual courier cost" would be a
        // Delhivery quote for a parcel Delhivery never touched, and the
        // margin computed from it is fiction that accumulates into the
        // P&L.
        const check =
          s.courierCode === 'shiprocket'
            ? await this.shiprocketCheck(s, originPin, weightGrams, isCod, billed)
            : await this.reconciliation.check(
                {
                  originPin,
                  destinationPin: s.destPostalCode,
                  chargeableWeightGrams: weightGrams,
                  isCod,
                  billedToSellerInr: billed.toString(),
                },
                courierActor.operator(staffId),
              );
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
        totalActual = totalActual.add(new Prisma.Decimal(check.actualCourierCostInr));
      } catch (err) {
        skipped.push({
          shipmentId: s.id,
          reason: err instanceof Error ? err.message : 'Cost lookup failed.',
        });
        continue;
      }

      /*
        NOTHING IS PERSISTED FROM HERE.

        This used to write the figure into `shipments.actual_courier_cost_inr`
        — "keep what we just paid to learn", which sounds thrifty and was
        wrong. That column is the INVOICED cost, and this endpoint is
        Delhivery's rate CALCULATOR: it answers what a parcel would be
        charged given its weight and pincodes, not what they billed.

        Writing an estimate there made it indistinguishable from a real
        charge — same column, same `actual_courier_cost_at` stamp — and
        the P&L reads that column as measured cost. The nightly wallet
        ledger sync overwrites it from the actual invoice, but only for
        AWBs inside the export window Delhivery returns (about a week),
        so a parcel estimated outside that window kept the guess
        permanently with nothing to say so.

        The invoice is the only thing that decides what a parcel cost.
        This report compares what we BILLED against a quote, which is
        useful for spotting a lane priced wrongly, and it says so.
      */
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
  /**
   * The same report, from what we ALREADY KNOW.
   *
   * ── WHY THIS EXISTS ──────────────────────────────────────────────────
   * The live run costs one rate-limited Delhivery call per parcel, so
   * the page ran only when asked — and therefore opened on "Not run
   * yet" over data it already had. Every priced parcel's cost was being
   * persisted to `shipments.actual_courier_cost_inr` (by this report,
   * and nightly by the wallet-ledger import), and none of it was shown
   * until somebody spent the calls again to re-learn it.
   *
   * This reads that column. No courier is contacted, nothing is
   * written, and it can be the page's default view — the live run then
   * has one job worth its cost: pricing the parcels that have no figure
   * yet.
   *
   * `skipped` names the UNPRICED ones rather than dropping them, because
   * "we have 11 of 12" is a different report from "we have 11", and only
   * one of them tells you to press Run.
   */
  async storedReport(input: { from: Date; to: Date; limit: number }): Promise<MarginReport> {
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
        courierCode: true,
        actualCourierCostInr: true,
        actualRtoCostInr: true,
        actualCourierCostAt: true,
        orderShipments: { select: { orderId: true }, take: 1 },
      },
    });

    const rows: MarginRow[] = [];
    const skipped: { shipmentId: string; reason: string }[] = [];
    let totalBilled = ZERO;
    let totalActual = ZERO;

    for (const s of shipments) {
      // What the parcel cost is BOTH columns: a returned parcel's forward
      // is ₹0 once Delhivery's refund is netted (COST-1), so reading the
      // forward alone would report a return as the most profitable
      // parcel we ever shipped.
      const fwd = s.actualCourierCostInr ?? null;
      const back = s.actualRtoCostInr ?? null;
      if (fwd === null && back === null) {
        skipped.push({
          shipmentId: s.id,
          reason: 'No courier cost recorded yet — run the live report to price this one.',
        });
        continue;
      }
      const orderId = s.orderShipments[0]?.orderId ?? null;
      const billed = orderId === null ? null : await this.billedShipping(orderId);
      if (billed === null) {
        skipped.push({
          shipmentId: s.id,
          reason: 'No shipping charges persisted for the order, so there is nothing to compare to.',
        });
        continue;
      }

      const actual = (fwd ?? ZERO).add(back ?? ZERO);
      const margin = billed.sub(actual);
      rows.push({
        shipmentId: s.id,
        shipmentNumber: s.shipmentNumber,
        awbNumber: s.awbNumber,
        orderId,
        // The lane is not stored — it was a property of the live quote,
        // not of the parcel. Reported as the destination alone rather
        // than invented, because a made-up lane label would be indexed,
        // grouped and reported on exactly like a real one.
        lane: s.destPostalCode,
        billedToSellerInr: billed.toFixed(2),
        actualCourierCostInr: actual.toFixed(2),
        marginInr: margin.toFixed(2),
        marginPercent: billed.isZero() ? '0.0' : margin.div(billed).mul(100).toFixed(1),
        lossMaking: margin.lessThan(0),
        // Both belong to the live comparison against the rate card and
        // are not stored. Null says "not known here" — a zero would say
        // "no drift", which is a claim we cannot make.
        assumedCostInr: null,
        assumptionDriftInr: null,
      });
      totalBilled = totalBilled.add(billed);
      totalActual = totalActual.add(actual);
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
    return charges.reduce((sum, c) => sum.add(c.totalAmountInr), new Prisma.Decimal(0));
  }
  /**
   * The same margin arithmetic, against Shiprocket's quote.
   *
   * Deliberately NOT a second copy of the reconciliation service: what
   * differs is only where the cost number comes from, and the
   * comparison, the loss-making threshold and the returned shape stay
   * identical — otherwise the report would mean two different things
   * depending on which courier a row happens to be.
   *
   * Their quote has no rate-card assumption to drift against, so the
   * drift columns are null rather than zero. Zero would claim the rate
   * card is exactly right about a courier it has never priced.
   */
  private async shiprocketCheck(
    s: {
      destPostalCode: string;
      courierAccountId: string | null;
    },
    originPin: string,
    weightGrams: number,
    isCod: boolean,
    billed: Prisma.Decimal,
  ): Promise<MarginCheck> {
    const lane = `${originPin}→${s.destPostalCode}`;
    if (s.courierAccountId === null) {
      throw new Error('No Shiprocket account recorded on this parcel, so it cannot be priced.');
    }
    const quote = await this.shiprocket.estimateLane(
      {
        pickupPincode: originPin,
        deliveryPincode: s.destPostalCode,
        weightGrams,
        isCod,
      },
      s.courierAccountId,
    );
    if (quote.totalInr === null) {
      // Skipped rather than counted as free. A zero cost would make
      // every such parcel look perfectly profitable and drag the
      // report's average with it.
      throw new Error('Shiprocket returned no rate for this lane.');
    }
    const actualCost = new Prisma.Decimal(quote.totalInr.toFixed(2));
    const margin = billed.sub(actualCost);
    const marginPercent = billed.isZero()
      ? new Prisma.Decimal(0)
      : margin.div(billed).mul(100).toDecimalPlaces(2);

    return {
      lane,
      billedToSellerInr: billed.toString(),
      actualCourierCostInr: actualCost.toString(),
      marginInr: margin.toString(),
      marginPercent: marginPercent.toString(),
      lossMaking: margin.lt(0),
      assumedCostInr: null,
      assumptionDriftInr: null,
    };
  }
}
