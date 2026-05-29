/**
 * Admin pricing surface (Module 15).
 *
 *   POST /admin/pricing/preview — pure calculation; no persistence.
 */
import type { ChargeType, PaymentMode, ServiceArea } from '@skydrop/db';

export interface PreviewPricingRequest {
  readonly sellerId: string;
  readonly recipientPostalCode: string;
  readonly recipientCountryCode?: string;
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: number;
  readonly declaredValueInr: number;
  readonly totalWeightGrams: number;
  readonly courierCode?: string;
  readonly serviceType?: string;
}

export type PricingUnresolvedReason =
  | 'NO_RATE_CARD'
  | 'NO_RATE_CARD_ITEM'
  | 'ZONE_FALLBACK_DEFAULT'
  | 'TIERED_SURCHARGE_NOT_IMPLEMENTED'
  | 'NO_COURIER'
  | 'NO_GST_RATE';

export interface PricingUnresolvedFallback {
  readonly reason: PricingUnresolvedReason;
  readonly detail?: string;
}

export interface PricingChargeLine {
  readonly type: ChargeType;
  readonly description: string;
  readonly amountInr: string;
  readonly surchargeRuleId: string | null;
}

export interface PricingPreviewResponse {
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
  readonly totalInr: string;
  readonly computationContext: Record<string, unknown>;
  readonly unresolved: readonly PricingUnresolvedFallback[];
}
