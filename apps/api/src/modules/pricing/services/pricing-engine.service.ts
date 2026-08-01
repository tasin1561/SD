import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type ChargeType, type PaymentMode, Prisma, type ServiceArea } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { MarginCalculationService, type MarginResult } from './margin-calculation.service';

/**
 * Pricing — a flat fee, per seller.
 *
 * One price to deliver a parcel anywhere in India. No zones, no weight
 * slabs, no surcharges, no rate-card lookup. The number comes from
 * `pricing.flat_delivery_fee_inr`, and a per-seller override of that key
 * beats the global default — the override is the one that counts, since
 * the rate is what was agreed with that particular seller.
 *
 * A returned parcel costs the delivery fee PLUS
 * `pricing.flat_rto_fee_inr` (default 200 + 30 = 230). The RTO half is
 * deliberately NOT computed here: it is charged when the return is
 * physically received, which is a warehouse event rather than an
 * order-create one. See `RtoFeeService`.
 *
 * ── Why this replaced the zone/slab engine ────────────────────────────
 * The previous engine resolved a rate card, a courier, a service type, a
 * postal zone and a weight slab, then layered percentage surcharges and
 * GST on top. Every one of those was somewhere the price could come out
 * wrong quietly — and one did: an unlisted pincode fell through to a
 * "DEFAULT" zone that no rate card item matched, and the order priced at
 * ₹0.00. A flat fee has no such seams. The rate-card, zone-matrix and
 * surcharge tables still exist; nothing reads them any more.
 *
 * ── GST ───────────────────────────────────────────────────────────────
 * `pricing.flat_fee_gst_percent` is seeded at **0**: today the flat fee
 * is what the seller pays, full stop. It is a setting rather than a
 * constant so switching it to 18 later is a decision, not a code change.
 * The GST line is written even at zero — the invoice reads that line,
 * and an absent one reads as "we forgot" rather than "none was charged".
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

/**
 * Reasons the engine could not resolve something it needed.
 *
 * Only one survives the move to flat pricing — the rest described
 * rate-card machinery nothing consults now. Kept as a union rather than
 * collapsed to a bare string because `OrderChargesService` filters on it
 * to decide whether a price is safe to persist, and a one-member union
 * invites that check quietly being dropped.
 */
export type UnresolvedReason = 'NO_FLAT_DELIVERY_FEE';

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
  /** base + surcharges + gst. */
  readonly totalInr: string;
  /** For persistence into OrderCharge.computationContext. */
  readonly computationContext: PricingComputationContext;
  readonly unresolved: readonly UnresolvedFallback[];
  /** Internal/admin-visible only; never surfaced to sellers, never touches the wallet. */
  readonly margin: MarginResult;
}

export interface PricingComputationContext {
  readonly engineVersion: 'flat-v1';
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
  readonly margin: MarginResult;
  /** Which fee was used, and whether it came from the seller or the default. */
  readonly flatFee: {
    readonly deliveryFeeInr: string;
    readonly source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
    readonly gstPercent: string;
  };
}

export const FLAT_DELIVERY_FEE_KEY = 'pricing.flat_delivery_fee_inr';
export const FLAT_RTO_FEE_KEY = 'pricing.flat_rto_fee_inr';
export const FLAT_FEE_GST_KEY = 'pricing.flat_fee_gst_percent';

export interface ResolvedFee {
  readonly amount: Prisma.Decimal;
  readonly source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
}

const DEFAULT_SERVICE_TYPE = 'standard';
/** Flat pricing has no zones; the field survives for the persisted shape. */
const FLAT_ZONE = 'FLAT';

@Injectable()
export class PricingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly marginCalc: MarginCalculationService,
  ) {}

  /**
   * The delivery fee for one seller, resolved through SET-1: their
   * override if they have one, otherwise the global default.
   */
  async resolveDeliveryFee(sellerId: string): Promise<ResolvedFee> {
    return this.resolveMoneySetting(sellerId, FLAT_DELIVERY_FEE_KEY);
  }

  /** The return fee, same resolution. Charged only when a parcel comes back. */
  async resolveRtoFee(sellerId: string): Promise<ResolvedFee> {
    return this.resolveMoneySetting(sellerId, FLAT_RTO_FEE_KEY);
  }

  /**
   * GST on the flat fees. GLOBAL only — a tax rate is set by law, not
   * negotiated per seller, so this deliberately does not go through the
   * per-seller resolver.
   */
  async resolveFeeGstPercent(): Promise<Prisma.Decimal> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: FLAT_FEE_GST_KEY },
      select: { valueDecimal: true },
    });
    // Absent ⇒ zero, matching the seed. Defaulting to 18 here would
    // start charging tax nobody configured.
    return new Prisma.Decimal(row?.valueDecimal ?? 0);
  }

  async compute(input: PricingComputeInput): Promise<PricingComputeOutput> {
    if (input.totalWeightGrams < 0) {
      throw new BadRequestException({
        code: 'INVALID_WEIGHT',
        message: 'totalWeightGrams must be >= 0',
      });
    }
    const asOf = input.asOf ?? new Date();
    const unresolved: UnresolvedFallback[] = [];

    const fee = await this.resolveDeliveryFee(input.sellerId);
    if (fee.amount.lessThanOrEqualTo(0)) {
      // Zero is almost always a missing setting rather than a decision to
      // ship for free. Flagging it lets OrderChargesService refuse to
      // record ₹0 as a real price — the exact failure the old engine had.
      unresolved.push({
        reason: 'NO_FLAT_DELIVERY_FEE',
        detail: `${FLAT_DELIVERY_FEE_KEY} resolved to ${fee.amount.toFixed(2)}`,
      });
    }

    const gstPercent = await this.resolveFeeGstPercent();
    const gstAmount = fee.amount.times(gstPercent).dividedBy(100);
    const totalInr = fee.amount.plus(gstAmount);

    // Weight is recorded, not charged on. It still matters elsewhere —
    // inbound freight is split by it — so the snapshot keeps it.
    const chargeableWeightGrams = Math.max(0, Math.floor(input.totalWeightGrams));

    // Margin against a courier cost no longer read from a rate card. The
    // honest figure comes from the courier's own invoice (the courier-ops
    // margin report), so this stays null rather than pretending.
    const margin = this.marginCalc.compute(fee.amount, null);

    const computationContext: PricingComputationContext = {
      engineVersion: 'flat-v1',
      evaluatedAt: asOf.toISOString(),
      sellerId: input.sellerId,
      rateCardId: null,
      courierId: null,
      serviceType: input.serviceType ?? DEFAULT_SERVICE_TYPE,
      zone: FLAT_ZONE,
      serviceArea: null,
      chargeableWeightGrams,
      sellerPricingId: null,
      appliedRules: [{ type: 'FLAT_DELIVERY_FEE', ruleId: null }],
      unresolved,
      margin,
      flatFee: {
        deliveryFeeInr: fee.amount.toFixed(2),
        source: fee.source,
        gstPercent: gstPercent.toFixed(2),
      },
    };

    return {
      rateCardId: null,
      rateCardCode: null,
      courierId: null,
      courierCode: input.courierCode ?? null,
      serviceType: input.serviceType ?? DEFAULT_SERVICE_TYPE,
      zone: FLAT_ZONE,
      serviceArea: null,
      chargeableWeightGrams,
      baseShippingInr: fee.amount.toFixed(2),
      sellerDiscountPercent: null,
      // Flat means flat. A returned parcel's extra fee is charged at RTO
      // receive, not predicted here.
      surcharges: [],
      gstRatePercent: gstPercent.toFixed(2),
      gstAmountInr: gstAmount.toFixed(2),
      totalInr: totalInr.toFixed(2),
      computationContext,
      unresolved,
      margin,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  private async resolveMoneySetting(sellerId: string, key: string): Promise<ResolvedFee> {
    const resolved = await this.settings.resolve(sellerId, key);
    const raw = resolved.value;
    if (raw === null || raw === undefined) {
      return { amount: new Prisma.Decimal(0), source: resolved.source };
    }
    return { amount: new Prisma.Decimal(String(raw)), source: resolved.source };
  }
}

// Re-export NotFoundException for the controllers/tests that need it
// to construct typed responses on a non-existent seller.
export { NotFoundException };
