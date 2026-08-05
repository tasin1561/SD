import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { DelhiveryCostService } from './delhivery-cost.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export interface MarginCheck {
  readonly lane: string;
  /** What we billed the seller for shipping (from order_charges). */
  readonly billedToSellerInr: string;
  /** What Delhivery says it actually costs us. */
  readonly actualCourierCostInr: string;
  /** billed − actual. Negative means we are shipping at a LOSS. */
  readonly marginInr: string;
  readonly marginPercent: string;
  /** True when we are losing money on this lane. */
  readonly lossMaking: boolean;
  /** What the rate card claims the cost is, when one was supplied. */
  readonly assumedCostInr: string | null;
  /** actual − assumed: how wrong the rate card's cost figure is. */
  readonly assumptionDriftInr: string | null;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Checking our margin against what the courier really charges.
 *
 * R1 wired `RateCardItem.costToSkydropInr` into a margin calculation, but
 * that field is a number somebody typed in. Margin was therefore the
 * difference between what we bill and what we ASSUMED it costs — which
 * is not margin, it is a hope. Delhivery's invoice-charges API returns
 * the real figure for a lane, so this service produces the honest
 * version: billed minus actual.
 *
 * Two failure modes it makes visible, neither of which was detectable
 * before:
 *  - **Loss-making lanes.** A rate card written when fuel was cheaper, a
 *    destination that turns out to be ODA-surcharged, a COD fee nobody
 *    accounted for. `lossMaking` is the flag; without it the loss only
 *    appears in aggregate, months later, as "why is the P&L off".
 *  - **Drift in the assumption.** `assumptionDriftInr` compares the rate
 *    card's typed cost to reality, so a systematically wrong card can be
 *    corrected rather than silently distorting every margin figure that
 *    reads from it.
 *
 * This is a REPORTING service. It never adjusts a rate card, a charge or
 * a wallet on its own — repricing is a commercial decision, and one made
 * on a single lane's reading would be a bad one.
 */
@Injectable()
export class DelhiveryMarginReconciliationService {
  private readonly logger = new Logger(DelhiveryMarginReconciliationService.name);

  constructor(private readonly cost: DelhiveryCostService) {}

  async check(
    input: {
      readonly originPin: string;
      readonly destinationPin: string;
      readonly chargeableWeightGrams: number;
      readonly isCod: boolean;
      /** What we charged the seller for shipping, all-in. */
      readonly billedToSellerInr: string;
      /** The rate card's assumed cost, if we want drift measured. */
      readonly assumedCostInr?: string;
      readonly billingMode?: 'S' | 'E';
    },
    actor?: CourierCredentialActor,
  ): Promise<MarginCheck> {
    const actual = await this.cost.estimate(
      {
        originPin: input.originPin,
        destinationPin: input.destinationPin,
        chargeableWeightGrams: input.chargeableWeightGrams,
        paymentType: input.isCod ? 'COD' : 'Pre-paid',
        ...(input.billingMode === undefined ? {} : { billingMode: input.billingMode }),
      },
      actor,
    );

    const billed = new Prisma.Decimal(input.billedToSellerInr);
    const actualCost = new Prisma.Decimal(actual.totalInr);
    const margin = billed.sub(actualCost);
    const marginPercent = billed.gt(0) ? margin.mul(100).div(billed).toDecimalPlaces(2) : ZERO;

    const assumed =
      input.assumedCostInr === undefined ? null : new Prisma.Decimal(input.assumedCostInr);
    const drift = assumed === null ? null : actualCost.sub(assumed);

    const lane = `${input.originPin}→${input.destinationPin}`;
    if (margin.lt(0)) {
      this.logger.warn(
        {
          lane,
          billed: billed.toString(),
          actual: actualCost.toString(),
          shortfall: margin.abs().toString(),
        },
        'LOSS-MAKING lane: the courier charges us more than we bill the seller',
      );
    }
    if (drift !== null && drift.abs().gt(new Prisma.Decimal(5))) {
      this.logger.warn(
        { lane, assumed: assumed?.toString(), actual: actualCost.toString() },
        'Rate card cost assumption has drifted from reality',
      );
    }

    return {
      lane,
      billedToSellerInr: billed.toString(),
      actualCourierCostInr: actualCost.toString(),
      marginInr: margin.toString(),
      marginPercent: marginPercent.toString(),
      lossMaking: margin.lt(0),
      assumedCostInr: assumed?.toString() ?? null,
      assumptionDriftInr: drift?.toString() ?? null,
    };
  }
}
