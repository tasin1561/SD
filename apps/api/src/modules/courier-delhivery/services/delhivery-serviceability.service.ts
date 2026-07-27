import { Injectable, Logger } from '@nestjs/common';
import { PaymentMode } from '@skydrop/db';
import { DelhiveryHttpService } from './delhivery-http.service';
import type { DelhiveryClient, DelhiveryServiceabilityResult } from '../types/delhivery.types';

/** The live pin record, as Delhivery actually returns it. */
interface DelhiveryPostalCode {
  pin?: number | string;
  /** "" = serviceable. "Embargo" = TEMPORARILY not serviceable. */
  remarks?: string;
  country_code?: string;
  state_code?: string;
  district?: string;
  /** Y/N per capability — a pin can be prepaid-only. */
  cod?: string;
  pre_paid?: string;
  pickup?: string;
  repl?: string;
  cash?: string;
  /** Out of Delivery Area: reachable, but slower and surcharged. */
  is_oda?: string;
  /** COD ceiling for this pin; 0 = no specific cap. */
  max_amount?: number;
  max_weight?: number;
  sort_code?: string;
}

export interface DelhiveryPinDetail {
  readonly pincode: string;
  /** Overall: known to Delhivery AND not under embargo. */
  readonly serviceable: boolean;
  readonly embargo: boolean;
  readonly codAllowed: boolean;
  readonly prepaidAllowed: boolean;
  readonly pickupAllowed: boolean;
  readonly replacementAllowed: boolean;
  readonly outOfDeliveryArea: boolean;
  /** 0 ⇒ no pin-specific cap. */
  readonly maxCodAmountInr: number;
  readonly maxWeightGrams: number;
  readonly stateCode: string | null;
  readonly district: string | null;
  readonly sortCode: string | null;
  readonly fromLiveApi: boolean;
}

const YES = (v: string | undefined): boolean => (v ?? '').trim().toUpperCase() === 'Y';

/**
 * Delhivery pincode serviceability — the real contract.
 *
 * ── WHY THIS IS MORE THAN "IS THE LIST NON-EMPTY" ────────────────────
 * Verified against the production API on 2026-07-27, three findings that
 * a length check silently gets wrong:
 *
 *  1. **Embargo.** PIN 190001 (Srinagar) returns a full record with
 *     `remarks: "Embargo"` — Delhivery knows the pin but is temporarily
 *     not serving it. A `length > 0` check calls that serviceable, we
 *     manifest the parcel, and it comes back at our cost.
 *  2. **Per-payment-mode.** `cod` and `pre_paid` are independent Y/N
 *     flags. For a COD-heavy business shipping into India, "serviceable"
 *     without asking "for COD?" is the wrong question.
 *  3. **Caps and ODA.** `max_amount` is a COD ceiling for that pin and
 *     `is_oda` marks out-of-delivery-area (slower, surcharged). Both
 *     change whether an order should be accepted as-is.
 *
 * An empty `delivery_codes` list is the true NSZ (non-serviceable zone)
 * signal — verified with PIN 999999.
 */
@Injectable()
export class DelhiveryServiceabilityService implements Pick<
  DelhiveryClient,
  'checkServiceability'
> {
  private readonly logger = new Logger(DelhiveryServiceabilityService.name);

  constructor(private readonly http: DelhiveryHttpService) {}

  /** The adapter-interface slice: a plain boolean for existing callers. */
  async checkServiceability(pincode: string): Promise<DelhiveryServiceabilityResult> {
    const detail = await this.describePin(pincode);
    return { serviceable: detail.serviceable, fromLiveApi: detail.fromLiveApi };
  }

  /**
   * Can we actually ship THIS order to THIS pin? The question the
   * pre-flight gate needs answered, rather than a bare boolean.
   */
  async canShip(input: {
    pincode: string;
    paymentMode: PaymentMode;
    codAmountInr?: number;
    weightGrams?: number;
  }): Promise<{ ok: boolean; reason: string | null; detail: DelhiveryPinDetail }> {
    const detail = await this.describePin(input.pincode);

    if (!detail.serviceable) {
      return {
        ok: false,
        reason: detail.embargo
          ? `Delhivery has a temporary EMBARGO on ${input.pincode}`
          : `${input.pincode} is not serviceable by Delhivery (NSZ)`,
        detail,
      };
    }
    if (input.paymentMode === PaymentMode.COD && !detail.codAllowed) {
      return {
        ok: false,
        reason: `${input.pincode} is serviceable but NOT for COD`,
        detail,
      };
    }
    if (input.paymentMode === PaymentMode.PREPAID && !detail.prepaidAllowed) {
      return {
        ok: false,
        reason: `${input.pincode} is serviceable but NOT for prepaid`,
        detail,
      };
    }
    if (
      input.paymentMode === PaymentMode.COD &&
      detail.maxCodAmountInr > 0 &&
      (input.codAmountInr ?? 0) > detail.maxCodAmountInr
    ) {
      return {
        ok: false,
        reason: `COD ₹${input.codAmountInr} exceeds the ₹${detail.maxCodAmountInr} cap for ${input.pincode}`,
        detail,
      };
    }
    if (detail.maxWeightGrams > 0 && (input.weightGrams ?? 0) > detail.maxWeightGrams) {
      return {
        ok: false,
        reason: `${input.weightGrams}g exceeds the ${detail.maxWeightGrams}g limit for ${input.pincode}`,
        detail,
      };
    }
    // ODA is NOT a rejection — it is reachable, just slower and dearer.
    // Surfaced on the detail so pricing/ETA can react.
    return { ok: true, reason: null, detail };
  }

  /** The full live record for a pin. */
  async describePin(pincode: string): Promise<DelhiveryPinDetail> {
    if (await this.http.isStubMode()) {
      return this.stubDetail(pincode);
    }

    const result = await this.http.request<{
      delivery_codes?: Array<{ postal_code?: DelhiveryPostalCode }>;
    }>({
      method: 'GET',
      path: `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`,
      endpoint: 'serviceability',
    });

    const pc = (result.delivery_codes ?? [])[0]?.postal_code;
    if (!pc) {
      // Empty list is the NSZ signal (verified: PIN 999999).
      return { ...this.emptyDetail(pincode), fromLiveApi: true };
    }

    const embargo = (pc.remarks ?? '').trim().toLowerCase() === 'embargo';
    if (embargo) {
      this.logger.warn(
        { pincode, remarks: pc.remarks },
        'Delhivery reports an EMBARGO on this pincode — treating as not serviceable',
      );
    }

    return {
      pincode,
      serviceable: !embargo,
      embargo,
      codAllowed: YES(pc.cod),
      prepaidAllowed: YES(pc.pre_paid),
      pickupAllowed: YES(pc.pickup),
      replacementAllowed: YES(pc.repl),
      outOfDeliveryArea: YES(pc.is_oda),
      maxCodAmountInr: Number(pc.max_amount ?? 0),
      maxWeightGrams: Number(pc.max_weight ?? 0),
      stateCode: pc.state_code ?? null,
      district: pc.district ?? null,
      sortCode: pc.sort_code ?? null,
      fromLiveApi: true,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  private emptyDetail(pincode: string): DelhiveryPinDetail {
    return {
      pincode,
      serviceable: false,
      embargo: false,
      codAllowed: false,
      prepaidAllowed: false,
      pickupAllowed: false,
      replacementAllowed: false,
      outOfDeliveryArea: false,
      maxCodAmountInr: 0,
      maxWeightGrams: 0,
      stateCode: null,
      district: null,
      sortCode: null,
      fromLiveApi: false,
    };
  }

  /** Stub mode keeps the pre-R-phase behaviour plus the new dimensions,
   *  so tests can drive every branch without a network. */
  private stubDetail(pincode: string): DelhiveryPinDetail {
    if (pincode === '000000') return this.emptyDetail(pincode);
    if (pincode === '190001') {
      return { ...this.emptyDetail(pincode), embargo: true };
    }
    return {
      pincode,
      serviceable: true,
      embargo: false,
      // 111111 is the stub's prepaid-only pin.
      codAllowed: pincode !== '111111',
      prepaidAllowed: true,
      pickupAllowed: true,
      replacementAllowed: true,
      outOfDeliveryArea: pincode === '222222',
      maxCodAmountInr: pincode === '333333' ? 5000 : 0,
      maxWeightGrams: 0,
      stateCode: 'KA',
      district: 'Stub District',
      sortCode: 'STB/STB',
      fromLiveApi: false,
    };
  }
}
