import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { DelhiveryHttpService } from './delhivery-cost-types';
import type { DelhiveryChargeRow } from './delhivery-cost-types';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export interface DelhiveryCostResult {
  /** What Delhivery bills us, all-in, including tax. */
  readonly totalInr: string;
  /** Before tax. */
  readonly grossInr: string;
  /** The forward delivery component alone. */
  readonly deliveryInr: string;
  /** COD handling fee (0 for prepaid). */
  readonly codFeeInr: string;
  /** Delhivery's own zone classification for this lane (e.g. "C2"). */
  readonly zone: string | null;
  /** The weight Delhivery actually charged for, grams. */
  readonly chargedWeightGrams: number;
  /** Volumetric divisor in force (5000 on this account). */
  readonly volumetricDivisor: number | null;
  readonly taxInr: string;
  readonly fromLiveApi: boolean;
  /** Every non-zero component, for the forensic trail. */
  readonly components: Readonly<Record<string, string>>;
}

const D = (v: unknown): Prisma.Decimal =>
  new Prisma.Decimal(Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * What Delhivery ACTUALLY charges for a lane — the other half of R1's
 * margin story.
 *
 * Until now `RateCardItem.costToSkydropInr` was a number somebody typed
 * in, and margin was measured against it. This service returns the real
 * figure from the courier, so margin becomes the difference between what
 * we bill the seller and what we are actually billed, rather than what
 * we assumed we would be.
 *
 * Verified against production 2026-07-27 (Delhi 110042 → Bangalore
 * 560001, 1500g, surface):
 *   prepaid → charge_DL 119, gross 124.39, total 146.79
 *   COD     → charge_DL 119, charge_COD 25, gross 149.39, total 176.29
 * with `zone: "C2"`, `charged_weight: 1500`, `divisor: 5000` and
 * `tax_data: {SGST: 11.2, CGST: 11.2, IGST: 0}`.
 *
 * Two things fall out of that response worth noting beyond the total:
 *  - **`divisor: 5000`** is the volumetric divisor. M15's pricing engine
 *    deferred volumetric weight; this is the number it would need
 *    (L×B×H/5000 vs dead weight, whichever is greater).
 *  - **`zone`** is Delhivery's own lane classification, which is a
 *    sounder input than our `ZoneResolverService` guessing from PIN
 *    prefixes.
 *
 * NOTE (from Delhivery's FAQ): staging returns 0 for every charge
 * because charges are not stored there. Only production answers
 * truthfully — which for this account is the only environment anyway.
 */
@Injectable()
export class DelhiveryCostService {
  private readonly logger = new Logger(DelhiveryCostService.name);

  constructor(private readonly http: DelhiveryHttpService) {}

  async estimate(
    input: {
      originPin: string;
      destinationPin: string;
      chargeableWeightGrams: number;
      /** 'S' surface (default) or 'E' express. */
      billingMode?: 'S' | 'E';
      paymentType: 'Pre-paid' | 'COD';
      /** Which leg to price: the forward delivery, an RTO or a DTO. */
      shipmentStatus?: 'Delivered' | 'RTO' | 'DTO';
      lengthCm?: number;
      breadthCm?: number;
      heightCm?: number;
    },
    actor?: CourierCredentialActor,
  ): Promise<DelhiveryCostResult> {
    if (await this.http.isStubMode()) {
      return this.stub(input.chargeableWeightGrams);
    }

    const qs = new URLSearchParams({
      md: input.billingMode ?? 'S',
      ss: input.shipmentStatus ?? 'Delivered',
      o_pin: input.originPin,
      d_pin: input.destinationPin,
      cgm: String(Math.max(0, Math.round(input.chargeableWeightGrams))),
      // Delhivery's FAQ: omitting `pt` is why the API returns 0.
      pt: input.paymentType,
    });
    if (input.lengthCm !== undefined) qs.set('l', String(input.lengthCm));
    if (input.breadthCm !== undefined) qs.set('b', String(input.breadthCm));
    if (input.heightCm !== undefined) qs.set('h', String(input.heightCm));

    const rows = await this.http.request<DelhiveryChargeRow[]>({
      actor,
      method: 'GET',
      path: `/api/kinko/v1/invoice/charges/.json?${qs.toString()}`,
      endpoint: 'cost',
    });

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) {
      this.logger.warn(input, 'Delhivery returned no charge row for this lane');
      return { ...this.stub(input.chargeableWeightGrams), fromLiveApi: true };
    }

    const tax = row.tax_data ?? {};
    const taxTotal = D(tax.SGST).add(D(tax.CGST)).add(D(tax.IGST)).add(D(tax.service_tax));

    // Keep every non-zero component: when a bill is disputed, "which
    // surcharge moved" is the only useful question.
    const components: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith('charge_') && Number(v) > 0) {
        components[k] = D(v).toString();
      }
    }

    return {
      totalInr: D(row.total_amount).toString(),
      grossInr: D(row.gross_amount).toString(),
      deliveryInr: D(row.charge_DL).toString(),
      codFeeInr: D(row.charge_COD).toString(),
      zone: row.zone ?? null,
      chargedWeightGrams: Number(row.charged_weight ?? 0),
      volumetricDivisor: row.divisor ?? null,
      taxInr: taxTotal.toString(),
      fromLiveApi: true,
      components,
    };
  }

  private stub(weightGrams: number): DelhiveryCostResult {
    return {
      totalInr: '0',
      grossInr: '0',
      deliveryInr: '0',
      codFeeInr: '0',
      zone: null,
      chargedWeightGrams: weightGrams,
      volumetricDivisor: 5000,
      taxInr: '0',
      fromLiveApi: false,
      components: {},
    };
  }
}
