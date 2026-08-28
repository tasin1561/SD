import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ShiprocketClientService } from '../../courier-shiprocket/services/shiprocket-client.service';
import { CourierDistributionService } from '../../courier-shared/services/courier-distribution.service';
import { Injectable } from '@nestjs/common';

// The SAME key the shipment context reads. Warehouses carry no address
// in the schema, and a second source for "where do we ship from" is how
// the two come to disagree.
const ORIGIN_PIN_SETTING = 'courier.delhivery_origin_pincode';
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
    private readonly shiprocket: ShiprocketClientService,
    private readonly distribution: CourierDistributionService,
    private readonly prisma: PrismaService,
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
      if (result.ok) return { ok: true, reason: result.reason };

      // ── ONE COURIER REFUSING IS NOT AN ANSWER ─────────────────────
      // Since the AWB saga fails over, a pin Delhivery will not serve
      // is still deliverable if Shiprocket serves it. Reporting it
      // unserviceable here would refuse an order the system would in
      // fact have shipped — the check would be stricter than the
      // behaviour it is meant to predict.
      const alsoRefused = await this.shiprocketRefuses(input);
      if (alsoRefused === false) return { ok: true, reason: null };
      // `null` means we could not ask — unknown, and unknown fails open
      // like everything else here.
      return alsoRefused === null
        ? { ok: true, reason: null }
        : { ok: false, reason: result.reason };
    });

    if (answer === null) {
      return { serviceable: true, reason: null, known: false };
    }
    return { serviceable: answer.serviceable, reason: answer.reason, known: true };
  }

  /**
   * Does Shiprocket also refuse this pin?
   *
   * `true` refused, `false` will carry it, `null` could not ask — and
   * the caller treats null as unknown rather than as a refusal, because
   * an unconfigured or unreachable second courier must not be able to
   * block an order Delhivery might not even have been asked about.
   */
  /**
   * The pin we ship FROM.
   *
   * Read from the same `courier.origin_pin` setting the shipment
   * context uses, rather than from the warehouse row — warehouses carry
   * no address in the schema, and a second source for the same fact is
   * how the two come to disagree about where we ship from.
   */
  private async originPincode(): Promise<string | null> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: ORIGIN_PIN_SETTING },
      select: { valueString: true },
    });
    const pin = (row?.valueString ?? '').trim();
    return /^\d{6}$/.test(pin) ? pin : null;
  }

  private async shiprocketRefuses(input: {
    pincode: string;
    paymentMode: PaymentMode;
    weightGrams?: number;
  }): Promise<boolean | null> {
    try {
      const account = await this.distribution.anyAccountFor('shiprocket');
      if (account === null) return null;
      // Their serviceability is a LANE — origin to destination — where
      // Delhivery's answers about the destination alone. The origin is
      // the warehouse we would actually ship from; without one there is
      // no lane to ask about, and no answer is better than a made-up
      // origin that quietly changes the verdict.
      const originPin = await this.originPincode();
      if (originPin === null) return null;
      const r = await this.shiprocket.checkServiceability(
        {
          pickupPincode: originPin,
          deliveryPincode: input.pincode,
          weightGrams: input.weightGrams ?? 500,
          isCod: input.paymentMode === PaymentMode.COD,
        },
        account.courierAccountId,
      );
      return !r.serviceable;
    } catch {
      return null;
    }
  }
}
