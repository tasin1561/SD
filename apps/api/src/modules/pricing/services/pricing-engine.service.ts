import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type ChargeType, Currency, type PaymentMode, Prisma, type ServiceArea } from '@skydrop/db';
import { type InrRateAt, inrRateAt, toInr } from '../../../common/fx/inr-rate-at';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { MarginCalculationService, type MarginResult } from './margin-calculation.service';

/**
 * Pricing — a flat fee, per seller.
 *
 * One price to deliver a parcel anywhere in India. No zones, no weight
 * slabs, no surcharges, no rate-card lookup. The number comes from
 * `pricing.flat_delivery_fee`, and a per-seller override of that key
 * beats the global default — the override is the one that counts, since
 * the rate is what was agreed with that particular seller.
 *
 * A returned parcel costs the delivery fee PLUS
 * `pricing.flat_rto_fee` (default 200 + 30 = 230). The RTO half is
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
export type UnresolvedReason =
  | 'NO_FLAT_DELIVERY_FEE'
  /** The fee is held in a currency we have no rate for, so it cannot be
   *  priced in rupees. Deliberately NOT a silent zero: charging nothing
   *  for a parcel that cost money is the failure this whole flag exists
   *  to prevent. */
  | 'NO_FX_RATE_FOR_FEE'
  /** The currency setting holds something that is not a currency. Fails
   *  closed for the same reason. */
  | 'BAD_FEE_CURRENCY';

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
    /** The fee as AGREED, before conversion. */
    readonly agreedAmount: string;
    readonly agreedCurrency: Currency | null;
    readonly currencySource: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
    /** Null when the fee was already in rupees. */
    readonly fxRate: string | null;
    readonly fxRatePair: string | null;
    readonly fxRateSource: 'HISTORY' | 'CURRENT' | 'IDENTITY' | null;
    readonly fxRateRecordedAt: string | null;
  };
}

export const FLAT_DELIVERY_FEE_KEY = 'pricing.flat_delivery_fee';
export const CUSTOMER_RETURN_FEE_KEY = 'pricing.customer_return_fee';
export const FLAT_RTO_FEE_KEY = 'pricing.flat_rto_fee';
export const FLAT_FEE_GST_KEY = 'pricing.flat_fee_gst_percent';

/**
 * Every fee's currency lives in its own key beside the amount, and both
 * are seller-overridable — so a negotiated fee is "৳250" or "₹180" as
 * ONE decision. Kept as a map rather than a `${key}_currency` rule so
 * that a fee without a currency key is a compile-time absence rather
 * than a silent runtime miss.
 */
export const FEE_CURRENCY_KEY: Readonly<Record<string, string>> = {
  [FLAT_DELIVERY_FEE_KEY]: 'pricing.flat_delivery_fee_currency',
  [FLAT_RTO_FEE_KEY]: 'pricing.flat_rto_fee_currency',
  [CUSTOMER_RETURN_FEE_KEY]: 'pricing.customer_return_fee_currency',
};

/** The currencies a fee may be agreed in. */
export const FEE_CURRENCIES: readonly Currency[] = [Currency.INR, Currency.BDT];

export interface ResolvedFee {
  /**
   * The amount AS AGREED, in `currency` — NOT necessarily rupees.
   *
   * Deliberately not called `amount`: it was rupees for the whole life
   * of this engine, and a caller that kept treating it as rupees after
   * the currency arrived would bill ৳200 as ₹200 and typecheck clean.
   * The rename makes every such call site fail to compile until it has
   * been looked at. Use `priceDeliveryFee`/`priceRtoFee` to get rupees.
   */
  readonly agreedAmount: Prisma.Decimal;
  readonly currency: Currency | null;
  readonly source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
  /** Where the CURRENCY came from; it is overridable independently. */
  readonly currencySource: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
}

/**
 * A fee resolved AND priced in rupees at a given instant.
 *
 * `priced` is the load-bearing field. False means we could not turn the
 * agreed amount into rupees — no FX rate, or a currency setting holding
 * something that is not a currency — and the caller must refuse rather
 * than bill the zero. `amountInr` is 0 in that case only so arithmetic
 * downstream does not need null-handling; nothing should reach that
 * arithmetic with `priced` false.
 */
export interface PricedFee {
  readonly amountInr: Prisma.Decimal;
  readonly priced: boolean;
  /** What was agreed, kept so the charge can be explained later. */
  readonly sourceAmount: Prisma.Decimal;
  readonly sourceCurrency: Currency | null;
  /** The rate used; null when the fee was already in rupees or unpriceable. */
  readonly rate: InrRateAt | null;
  readonly source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
  readonly currencySource: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
  readonly unresolved: readonly UnresolvedFallback[];
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

  /**
   * The delivery fee IN RUPEES at `at`.
   *
   * `at` is the moment the charge is taken, not the moment the order was
   * placed — for delivery those coincide, but for the RTO fee they are
   * weeks apart and a different rate, which is correct: the fee is
   * charged then, so it is priced then.
   */
  async priceDeliveryFee(sellerId: string, at: Date): Promise<PricedFee> {
    return this.priceFee(sellerId, FLAT_DELIVERY_FEE_KEY, at);
  }

  /** The return fee in rupees at the moment the return is received. */
  async priceRtoFee(sellerId: string, at: Date): Promise<PricedFee> {
    return this.priceFee(sellerId, FLAT_RTO_FEE_KEY, at);
  }

  /** The customer-return fee in rupees at the moment it is charged. */
  async priceCustomerReturnFee(sellerId: string, at: Date): Promise<PricedFee> {
    return this.priceFee(sellerId, CUSTOMER_RETURN_FEE_KEY, at);
  }

  /** The return fee, same resolution. Charged only when a parcel comes back. */
  async resolveRtoFee(sellerId: string): Promise<ResolvedFee> {
    return this.resolveMoneySetting(sellerId, FLAT_RTO_FEE_KEY);
  }

  /**
   * What a CUSTOMER-asked return costs the seller.
   *
   * A separate setting from the RTO fee, and much larger, because it is
   * a different event: the parcel was delivered and now travels the
   * whole distance back, which is a second delivery. An RTO never
   * reached the customer at all. Pricing them the same would either
   * overcharge a failed first attempt or undercharge a genuine second
   * leg, and one of those is us losing money on every return.
   */
  async resolveCustomerReturnFee(sellerId: string): Promise<ResolvedFee> {
    return this.resolveMoneySetting(sellerId, CUSTOMER_RETURN_FEE_KEY);
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

    const fee = await this.priceDeliveryFee(input.sellerId, asOf);
    // A fee we could not price in rupees is flagged FIRST and on its own
    // terms: "no BDT rate" is a different problem from "the fee is zero",
    // and reporting the second when the first is true sends whoever
    // reads it to the wrong setting.
    unresolved.push(...fee.unresolved);
    if (fee.amountInr.lessThanOrEqualTo(0) && fee.priced) {
      // Zero is almost always a missing setting rather than a decision to
      // ship for free. Flagging it lets OrderChargesService refuse to
      // record ₹0 as a real price — the exact failure the old engine had.
      unresolved.push({
        reason: 'NO_FLAT_DELIVERY_FEE',
        detail:
          `${FLAT_DELIVERY_FEE_KEY} resolved to ${fee.sourceAmount.toFixed(2)} ${fee.sourceCurrency ?? ''}`.trim(),
      });
    }

    const gstPercent = await this.resolveFeeGstPercent();
    const gstAmount = fee.amountInr.times(gstPercent).dividedBy(100);
    const totalInr = fee.amountInr.plus(gstAmount);

    // Weight is recorded, not charged on. It still matters elsewhere —
    // inbound freight is split by it — so the snapshot keeps it.
    const chargeableWeightGrams = Math.max(0, Math.floor(input.totalWeightGrams));

    // Margin against a courier cost no longer read from a rate card. The
    // honest figure comes from the courier's own invoice (the courier-ops
    // margin report), so this stays null rather than pretending.
    const margin = this.marginCalc.compute(fee.amountInr, null);

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
        deliveryFeeInr: fee.amountInr.toFixed(2),
        source: fee.source,
        gstPercent: gstPercent.toFixed(2),
        // What was AGREED, and how it became rupees. Without these three
        // "why was I charged ₹162.60?" has no answer a month later, when
        // the rate has moved and the setting may have changed too.
        agreedAmount: fee.sourceAmount.toFixed(2),
        agreedCurrency: fee.sourceCurrency,
        currencySource: fee.currencySource,
        fxRate: fee.rate === null ? null : fee.rate.storedRate,
        fxRatePair: fee.rate === null ? null : fee.rate.storedPair,
        fxRateSource: fee.rate === null ? null : fee.rate.source,
        fxRateRecordedAt: fee.rate?.recordedAt?.toISOString() ?? null,
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
      baseShippingInr: fee.amountInr.toFixed(2),
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
    const currencyKey = FEE_CURRENCY_KEY[key];
    // A fee with no currency key is an INR fee by construction — the
    // shape every money setting had before currencies existed. Reading
    // an absent key as INR keeps those working untouched.
    const currencyResolved = currencyKey
      ? await this.settings.resolve(sellerId, currencyKey)
      : null;
    const rawCurrency =
      currencyResolved?.value === null || currencyResolved?.value === undefined
        ? Currency.INR
        : String(currencyResolved.value).toUpperCase();
    const currency = (FEE_CURRENCIES as readonly string[]).includes(rawCurrency)
      ? (rawCurrency as Currency)
      : null;
    const currencySource = currencyResolved?.source ?? 'SYSTEM_DEFAULT';

    const raw = resolved.value;
    const amount =
      raw === null || raw === undefined ? new Prisma.Decimal(0) : new Prisma.Decimal(String(raw));
    return { agreedAmount: amount, currency, source: resolved.source, currencySource };
  }

  /**
   * Turn an agreed fee into rupees at `at`.
   *
   * Conversion goes through the SAME helper the P&L and inbound freight
   * use (`inrRateAt`), so the rupees a seller is charged and the figure
   * the report derives cannot disagree. It returns null when there is no
   * rate at all, and that is passed through as `priced: false` rather
   * than smoothed into a zero.
   */
  private async priceFee(sellerId: string, key: string, at: Date): Promise<PricedFee> {
    const fee = await this.resolveMoneySetting(sellerId, key);
    const base = {
      sourceAmount: fee.agreedAmount,
      sourceCurrency: fee.currency,
      source: fee.source,
      currencySource: fee.currencySource,
    };
    if (fee.currency === null) {
      return {
        ...base,
        amountInr: new Prisma.Decimal(0),
        priced: false,
        rate: null,
        unresolved: [
          {
            reason: 'BAD_FEE_CURRENCY',
            detail: `${FEE_CURRENCY_KEY[key]} is not one of ${FEE_CURRENCIES.join(', ')}`,
          },
        ],
      };
    }
    if (fee.currency === Currency.INR) {
      return { ...base, amountInr: fee.agreedAmount, priced: true, rate: null, unresolved: [] };
    }
    const rate = await inrRateAt(this.prisma.client, fee.currency, at);
    if (rate === null) {
      return {
        ...base,
        amountInr: new Prisma.Decimal(0),
        priced: false,
        rate: null,
        unresolved: [
          {
            reason: 'NO_FX_RATE_FOR_FEE',
            detail: `no ${fee.currency} → INR rate at ${at.toISOString()}, so ${key} cannot be priced`,
          },
        ],
      };
    }
    return {
      ...base,
      amountInr: toInr(fee.agreedAmount, rate),
      priced: true,
      rate,
      unresolved: [],
    };
  }
}

// Re-export NotFoundException for the controllers/tests that need it
// to construct typed responses on a non-existent seller.
export { NotFoundException };
