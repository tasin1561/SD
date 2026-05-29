import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChargeType,
  type PaymentMode,
  Prisma,
  type ServiceArea,
  SurchargeBaseField,
  SurchargeComputationMethod,
  SurchargeType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ZoneResolverService, type ZoneResolution } from './zone-resolver.service';

/**
 * Module 15 — Pricing Engine. Pure calculation; no persistence. The
 * input describes a (real or hypothetical) order; the output is a
 * structured breakdown that the caller can persist (M6 order create
 * fast-follow) or surface in an admin preview (M15.2).
 *
 * **Algorithm** (per CLAUDE.md pricing rules):
 *   1. Resolve the rate card: priority SellerPricing → default RateCard.
 *   2. Resolve courier + service type (defaults via system_settings).
 *   3. Resolve zone: PIN → ServiceArea → ZoneMatrixEntry per courier.
 *      On miss, fall back to the literal zone string "DEFAULT".
 *   4. Resolve chargeable weight. Phase 1A uses ACTUAL weight only
 *      (volumetric calculation deferred — the courier's volumetric
 *      divisor lives on Courier.volumetricDivisor for a future bump).
 *   5. Look up RateCardItem (rateCard, courier, serviceType, zone,
 *      weight slab containing chargeableWeightGrams). On miss, the
 *      base shipping is 0 + an UNRESOLVED flag.
 *   6. Apply SellerPricing.discountPercent to the base if present.
 *   7. Apply applicable SurchargeRules (active + paymentMode-match +
 *      serviceArea-match). FLAT = flatAmountInr; PERCENTAGE = percent
 *      of baseField (clamped to min/max if set); TIERED → 0 + flag
 *      (deferred). COD_FEE additionally honors SellerPricing.
 *      codFeePercent on top of any matching rule, OR by itself when
 *      no rule is present (so a seller-specific COD rate works
 *      without an explicit rate-card rule).
 *   8. Compute GST: 18% (or pricing.gst_rate) of
 *      (baseShipping + sum(surcharges)). GST is its OWN line; the
 *      per-line `taxAmountInr` is NOT populated to avoid
 *      double-counting (the GST line IS the tax).
 *   9. Return a structured breakdown with the `computationContext`
 *      JSON suitable for `OrderCharge.computationContext`.
 *
 * Historical accuracy: pass `asOf` to evaluate against the rate card
 * + seller pricing + surcharges that were effective then. Default is
 * `now`. Once persisted, charges are immutable per the CLAUDE.md
 * pricing rule.
 */

export interface PricingComputeInput {
  readonly sellerId: string;
  readonly recipientPostalCode: string;
  readonly recipientCountryCode?: string;
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: number;
  readonly declaredValueInr: number;
  readonly totalWeightGrams: number;
  readonly courierCode?: string;
  readonly serviceType?: string;
  readonly asOf?: Date;
}

export type UnresolvedReason =
  | 'NO_RATE_CARD'
  | 'NO_RATE_CARD_ITEM'
  | 'ZONE_FALLBACK_DEFAULT'
  | 'TIERED_SURCHARGE_NOT_IMPLEMENTED'
  | 'NO_COURIER'
  | 'NO_GST_RATE';

export interface UnresolvedFallback {
  readonly reason: UnresolvedReason;
  readonly detail?: string;
}

export interface PricingChargeLine {
  readonly type: ChargeType;
  readonly description: string;
  readonly amountInr: string;
  readonly surchargeRuleId: string | null;
}

export interface PricingComputeOutput {
  readonly rateCardId: string | null;
  readonly rateCardCode: string | null;
  readonly courierId: string | null;
  readonly courierCode: string | null;
  readonly serviceType: string;
  readonly zone: string;
  readonly serviceArea: ServiceArea | null;
  readonly chargeableWeightGrams: number;
  readonly baseShippingInr: string;
  readonly sellerDiscountPercent: string | null;
  readonly surcharges: readonly PricingChargeLine[];
  readonly gstRatePercent: string;
  readonly gstAmountInr: string;
  /** Sum of base + surcharges + gst. */
  readonly totalInr: string;
  /** For persistence into OrderCharge.computationContext. */
  readonly computationContext: PricingComputationContext;
  readonly unresolved: readonly UnresolvedFallback[];
}

export interface PricingComputationContext {
  readonly engineVersion: 'm15-v1';
  readonly evaluatedAt: string;
  readonly sellerId: string;
  readonly rateCardId: string | null;
  readonly courierId: string | null;
  readonly serviceType: string;
  readonly zone: string;
  readonly serviceArea: ServiceArea | null;
  readonly chargeableWeightGrams: number;
  readonly sellerPricingId: string | null;
  readonly appliedRules: readonly { readonly type: string; readonly ruleId: string | null }[];
  readonly unresolved: readonly UnresolvedFallback[];
}

const DEFAULT_SERVICE_TYPE = 'standard';
const DEFAULT_ZONE = 'DEFAULT';
const DEFAULT_GST_RATE = '18';

@Injectable()
export class PricingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zoneResolver: ZoneResolverService,
  ) {}

  async compute(input: PricingComputeInput): Promise<PricingComputeOutput> {
    if (input.totalWeightGrams < 0) {
      throw new BadRequestException({
        code: 'INVALID_WEIGHT',
        message: 'totalWeightGrams must be >= 0',
      });
    }
    const asOf = input.asOf ?? new Date();
    const unresolved: UnresolvedFallback[] = [];
    const appliedRules: { type: string; ruleId: string | null }[] = [];

    // 1-2. Rate card + seller pricing + courier.
    const sellerPricing = await this.findSellerPricing(input.sellerId, asOf);
    const rateCard =
      (sellerPricing
        ? await this.prisma.client.rateCard.findFirst({
            where: { id: sellerPricing.rateCardId, deletedAt: null },
          })
        : null) ??
      (await this.findDefaultRateCard(asOf));
    if (!rateCard) {
      unresolved.push({ reason: 'NO_RATE_CARD' });
    }

    const courierCode = input.courierCode ?? (await this.getOpsSetting('ops.default_courier_code'));
    const courier = courierCode
      ? await this.prisma.client.courier.findUnique({
          where: { code: courierCode },
        })
      : null;
    if (!courier) {
      unresolved.push({ reason: 'NO_COURIER', detail: courierCode ?? 'no default' });
    }

    const serviceType = input.serviceType ?? DEFAULT_SERVICE_TYPE;

    // 3. Zone resolution.
    const zoneRes: ZoneResolution = await this.zoneResolver.resolve({
      pinCode: input.recipientPostalCode,
      countryCode: input.recipientCountryCode ?? 'IN',
      courierId: courier?.id ?? null,
    });
    const zone = zoneRes.zone ?? DEFAULT_ZONE;
    if (!zoneRes.zone) {
      unresolved.push({ reason: 'ZONE_FALLBACK_DEFAULT' });
    }

    // 4. Chargeable weight (actual; volumetric deferred).
    const chargeableWeightGrams = Math.max(0, Math.floor(input.totalWeightGrams));

    // 5. Base shipping from RateCardItem.
    const baseRow =
      rateCard && courier
        ? await this.prisma.client.rateCardItem.findFirst({
            where: {
              rateCardId: rateCard.id,
              courierId: courier.id,
              serviceType,
              zone,
              weightSlabFromGrams: { lte: chargeableWeightGrams },
              weightSlabToGrams: { gte: chargeableWeightGrams },
              isActive: true,
            },
          })
        : null;
    let baseShipping = baseRow ? new Prisma.Decimal(baseRow.baseChargeInr) : new Prisma.Decimal(0);
    if (baseRow && baseRow.perKgChargeInr && chargeableWeightGrams > baseRow.weightSlabFromGrams) {
      const overweightGrams = chargeableWeightGrams - baseRow.weightSlabFromGrams;
      const overweightKg = new Prisma.Decimal(overweightGrams).dividedBy(1000);
      baseShipping = baseShipping.plus(new Prisma.Decimal(baseRow.perKgChargeInr).times(overweightKg));
    }
    if (!baseRow && rateCard && courier) {
      unresolved.push({
        reason: 'NO_RATE_CARD_ITEM',
        detail: `${courier.code}/${serviceType}/${zone}/${chargeableWeightGrams}g`,
      });
    }

    // 6. Seller discount.
    const sellerDiscountPercent = sellerPricing?.discountPercent
      ? new Prisma.Decimal(sellerPricing.discountPercent)
      : null;
    if (sellerDiscountPercent) {
      baseShipping = baseShipping.times(new Prisma.Decimal(1).minus(sellerDiscountPercent.dividedBy(100)));
    }

    // 7. Surcharges.
    const surcharges: PricingChargeLine[] = [];
    const surchargeRules = rateCard
      ? await this.prisma.client.surchargeRule.findMany({
          where: { rateCardId: rateCard.id, isActive: true, deletedAt: null },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        })
      : [];
    for (const rule of surchargeRules) {
      if (
        rule.appliesOnlyIfPaymentMode &&
        rule.appliesOnlyIfPaymentMode !== input.paymentMode
      ) {
        continue;
      }
      if (
        rule.appliesOnlyForServiceAreas.length > 0 &&
        (!zoneRes.serviceArea ||
          !rule.appliesOnlyForServiceAreas.includes(zoneRes.serviceArea))
      ) {
        continue;
      }
      let amount = new Prisma.Decimal(0);
      switch (rule.computationMethod) {
        case SurchargeComputationMethod.FLAT:
          amount = new Prisma.Decimal(rule.flatAmountInr ?? 0);
          break;
        case SurchargeComputationMethod.PERCENTAGE: {
          const pct = new Prisma.Decimal(rule.percentage ?? 0).dividedBy(100);
          const base = this.resolveSurchargeBase(rule.baseField, {
            baseShipping,
            codAmountInr: input.codAmountInr,
            declaredValueInr: input.declaredValueInr,
            chargeableWeightGrams,
          });
          amount = base.times(pct);
          break;
        }
        case SurchargeComputationMethod.TIERED:
          unresolved.push({
            reason: 'TIERED_SURCHARGE_NOT_IMPLEMENTED',
            detail: rule.id,
          });
          amount = new Prisma.Decimal(0);
          break;
        default: {
          const exhaustive: never = rule.computationMethod;
          throw new Error(`Unhandled SurchargeComputationMethod: ${String(exhaustive)}`);
        }
      }
      if (rule.minAmountInr && amount.lessThan(rule.minAmountInr)) {
        amount = new Prisma.Decimal(rule.minAmountInr);
      }
      if (rule.maxAmountInr && amount.greaterThan(rule.maxAmountInr)) {
        amount = new Prisma.Decimal(rule.maxAmountInr);
      }
      if (amount.greaterThan(0)) {
        surcharges.push({
          type: this.surchargeTypeToChargeType(rule.type),
          description: rule.name,
          amountInr: amount.toFixed(2),
          surchargeRuleId: rule.id,
        });
        appliedRules.push({ type: rule.type, ruleId: rule.id });
      }
    }

    // 7b. Seller-pricing COD fee (separate from rule-driven COD fees).
    if (
      sellerPricing?.codFeePercent &&
      input.paymentMode === 'COD' &&
      input.codAmountInr > 0
    ) {
      const cod = new Prisma.Decimal(input.codAmountInr);
      const codFee = cod.times(new Prisma.Decimal(sellerPricing.codFeePercent).dividedBy(100));
      if (codFee.greaterThan(0)) {
        surcharges.push({
          type: ChargeType.COD_FEE,
          description: 'COD fee (seller pricing)',
          amountInr: codFee.toFixed(2),
          surchargeRuleId: null,
        });
        appliedRules.push({
          type: 'SELLER_PRICING_COD_FEE',
          ruleId: sellerPricing.id,
        });
      }
    }

    // 8. GST.
    const gstRateRaw = await this.getOpsSetting('pricing.gst_rate');
    const gstRate = gstRateRaw ?? DEFAULT_GST_RATE;
    if (!gstRateRaw) {
      unresolved.push({ reason: 'NO_GST_RATE', detail: `defaulted to ${DEFAULT_GST_RATE}` });
    }
    const taxableBase = surcharges.reduce(
      (acc, l) => acc.plus(new Prisma.Decimal(l.amountInr)),
      baseShipping,
    );
    const gstAmount = taxableBase.times(new Prisma.Decimal(gstRate).dividedBy(100));

    const totalInr = taxableBase.plus(gstAmount).toFixed(2);

    const computationContext: PricingComputationContext = {
      engineVersion: 'm15-v1',
      evaluatedAt: asOf.toISOString(),
      sellerId: input.sellerId,
      rateCardId: rateCard?.id ?? null,
      courierId: courier?.id ?? null,
      serviceType,
      zone,
      serviceArea: zoneRes.serviceArea ?? null,
      chargeableWeightGrams,
      sellerPricingId: sellerPricing?.id ?? null,
      appliedRules,
      unresolved,
    };

    return {
      rateCardId: rateCard?.id ?? null,
      rateCardCode: rateCard?.code ?? null,
      courierId: courier?.id ?? null,
      courierCode: courier?.code ?? null,
      serviceType,
      zone,
      serviceArea: zoneRes.serviceArea ?? null,
      chargeableWeightGrams,
      baseShippingInr: baseShipping.toFixed(2),
      sellerDiscountPercent: sellerDiscountPercent?.toFixed(2) ?? null,
      surcharges,
      gstRatePercent: new Prisma.Decimal(gstRate).toFixed(2),
      gstAmountInr: gstAmount.toFixed(2),
      totalInr,
      computationContext,
      unresolved,
    };
  }

  // ── internals ──

  private async findSellerPricing(sellerId: string, asOf: Date): Promise<{
    id: string;
    rateCardId: string;
    discountPercent: Prisma.Decimal | null;
    codFeePercent: Prisma.Decimal | null;
  } | null> {
    const row = await this.prisma.client.sellerPricing.findFirst({
      where: {
        sellerId,
        isActive: true,
        deletedAt: null,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row;
  }

  private async findDefaultRateCard(asOf: Date): Promise<{
    id: string;
    code: string;
  } | null> {
    const row = await this.prisma.client.rateCard.findFirst({
      where: {
        isDefault: true,
        isActive: true,
        deletedAt: null,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row;
  }

  private async getOpsSetting(key: string): Promise<string | null> {
    const row = await this.prisma.client.systemSetting.findUnique({ where: { key } });
    if (!row) return null;
    if (row.valueString !== null) return row.valueString;
    if (row.valueDecimal !== null) return row.valueDecimal.toString();
    if (row.valueInt !== null) return String(row.valueInt);
    return null;
  }

  private resolveSurchargeBase(
    field: SurchargeBaseField | null,
    ctx: {
      baseShipping: Prisma.Decimal;
      codAmountInr: number;
      declaredValueInr: number;
      chargeableWeightGrams: number;
    },
  ): Prisma.Decimal {
    if (!field) return ctx.baseShipping;
    switch (field) {
      case SurchargeBaseField.SHIPPING_CHARGE:
        return ctx.baseShipping;
      case SurchargeBaseField.COD_AMOUNT:
        return new Prisma.Decimal(ctx.codAmountInr);
      case SurchargeBaseField.DECLARED_VALUE:
        return new Prisma.Decimal(ctx.declaredValueInr);
      case SurchargeBaseField.CHARGEABLE_WEIGHT:
        return new Prisma.Decimal(ctx.chargeableWeightGrams);
      default: {
        const exhaustive: never = field;
        throw new Error(`Unhandled SurchargeBaseField: ${String(exhaustive)}`);
      }
    }
  }

  private surchargeTypeToChargeType(t: SurchargeType): ChargeType {
    switch (t) {
      case SurchargeType.COD_FEE:
        return ChargeType.COD_FEE;
      case SurchargeType.FUEL_SURCHARGE:
        return ChargeType.FUEL_SURCHARGE;
      case SurchargeType.REMOTE_AREA_FEE:
        return ChargeType.REMOTE_AREA_FEE;
      case SurchargeType.RTO_FEE:
        return ChargeType.RTO_FEE;
      case SurchargeType.WEIGHT_DISPUTE_FEE:
        return ChargeType.WEIGHT_DISPUTE_FEE;
      case SurchargeType.RESHIPMENT_FEE:
        return ChargeType.RESHIPMENT_FEE;
      case SurchargeType.ADDRESS_CORRECTION_FEE:
      case SurchargeType.OTHER:
        return ChargeType.OTHER;
      default: {
        const exhaustive: never = t;
        throw new Error(`Unhandled SurchargeType: ${String(exhaustive)}`);
      }
    }
  }
}

// Re-export NotFoundException for the controllers/tests that need it
// to construct typed responses on a non-existent seller.
export { NotFoundException };
