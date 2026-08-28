import { Injectable } from '@nestjs/common';
import { PaymentMode } from '@skydrop/db';
import { DelhiveryServiceabilityService } from '../../courier-delhivery/services/delhivery-serviceability.service';
import { ServiceabilityCacheService } from './serviceability-cache.service';

export interface ServiceabilityVerdict {
  /** False only when we KNOW it is not deliverable. */
  readonly serviceable: boolean;
  /** Null when nothing is wrong, or when we could not find out. */
  readonly reason: string | null;
  /** True when we actually got an answer. False means unknown. */
  readonly known: boolean;
}

/**
 * Can we deliver to this pin, asked in the two places it matters.
 *
 * At order CREATE it is a warning — the seller is told before they
 * commit, and can proceed anyway. Refusing outright would be wrong:
 * serviceability changes, our answer may be stale by a day, and a seller
 * who knows their own customer's area better than a lookup does should
 * not be blocked by it.
 *
 * At call-centre CONFIRMATION it is a gate worth acting on. That is the
 * last cheap moment — stock has not been reserved, an AWB has not been
 * bought, and the agent has the customer on the line and can ask for a
 * different address. After that the discovery costs a picked parcel and
 * a rejected AWB (CUR-5, reactive).
 *
 * ── UNKNOWN IS NOT UNSERVICEABLE ─────────────────────────────────────
 * Every path fails OPEN. A courier that will not answer, a cache that
 * will not read, a stub environment — none of those mean the parcel
 * cannot be delivered, and treating them as refusals would stop the
 * business over an outage somewhere else.
 */
@Injectable()
export class OrderServiceabilityService {
  constructor(
    private readonly cache: ServiceabilityCacheService,
    private readonly delhivery: DelhiveryServiceabilityService,
  ) {}

  async check(input: {
    pincode: string;
    paymentMode: PaymentMode;
    codAmountInr?: number;
    weightGrams?: number;
  }): Promise<ServiceabilityVerdict> {
    // A pin that is not six digits is a validation problem, not a
    // serviceability one, and the DTO already refuses it. Guarding here
    // stops a malformed value becoming a courier call.
    if (!/^\d{6}$/.test(input.pincode)) {
      return { serviceable: true, reason: null, known: false };
    }

    const answer = await this.cache.get(input.pincode, input.paymentMode, async () => {
      const result = await this.delhivery.canShip({
        pincode: input.pincode,
        paymentMode: input.paymentMode,
        ...(input.codAmountInr === undefined ? {} : { codAmountInr: input.codAmountInr }),
        ...(input.weightGrams === undefined ? {} : { weightGrams: input.weightGrams }),
      });
      return { ok: result.ok, reason: result.reason };
    });

    if (answer === null) {
      return { serviceable: true, reason: null, known: false };
    }
    return { serviceable: answer.serviceable, reason: answer.reason, known: true };
  }
}
