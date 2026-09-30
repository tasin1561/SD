import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Currency } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { PricingEngineService, type PricedFee } from '../services/pricing-engine.service';

/** One fee, as agreed and as it will actually be charged. */
export interface SellerFeeView {
  /** `delivery` | `return` | `customerReturn` — what the caller asked for. */
  readonly kind: 'delivery' | 'return' | 'customerReturn';
  /**
   * What the wallet will be debited, in rupees — or NULL when we could
   * not work it out.
   *
   * Null rather than zero, and that distinction is the whole reason this
   * endpoint exists. A fee agreed in taka with no FX rate on file is
   * unpriceable, and PRC-8 already refuses to CHARGE a zero in that
   * case; showing one here would promise a free return and then take
   * money for it. A caller that cannot read a figure says so.
   */
  readonly amountInr: string | null;
  /** What was agreed, before conversion — "৳200" as well as "₹162.60". */
  readonly agreedAmount: string;
  readonly agreedCurrency: Currency | null;
  /**
   * The FX row EXACTLY AS STORED — "1.35" with pair "INR/BDT" — not the
   * reciprocal the conversion used. A seller checking a figure against
   * the rate we publish has to be given the number they can see, and
   * `inrPerUnit` here is `1/1.35`, which prints as twenty decimals and
   * matches nothing on any screen.
   *
   * Both null when the fee was already in rupees, or could not be priced.
   */
  readonly fxRate: string | null;
  readonly fxRatePair: string | null;
}

function view(kind: SellerFeeView['kind'], priced: PricedFee): SellerFeeView {
  return {
    kind,
    amountInr: priced.priced ? priced.amountInr.toFixed(2) : null,
    agreedAmount: priced.sourceAmount.toFixed(2),
    agreedCurrency: priced.sourceCurrency,
    fxRate: priced.rate === null ? null : priced.rate.storedRate,
    fxRatePair: priced.rate === null ? null : priced.rate.storedPair,
  };
}

/**
 * What moving a parcel costs this seller, in money.
 *
 * WHY THIS EXISTS. Every one of these three figures is a per-seller
 * setting (SET-1, PRC-8) with its own currency beside it, and until this
 * endpoint landed **not one of them was readable anywhere in the seller
 * app**. `/wallet/limits` lists the wallet's terms and deliberately
 * names only the TIMING of the delivery fee ("when the AWB is made, or
 * when the parcel is delivered"), never the amount. The single place a
 * seller ever saw a figure was the return dialog, which carried the
 * literal `₹200` in its copy — right for the seeded default and wrong
 * for any seller who negotiated one, and wrong for everybody the day the
 * global default moves. The delivery fee's default moved from ₹200 to
 * ৳200 on 2026-09-20 and nothing on screen changed.
 *
 * So the figures come from the engine that will actually take the money,
 * priced at the moment they are read — which is as close to the moment
 * they will be charged as a quote can get.
 *
 * GATED ON `orders.view`, NOT `wallet.view`. The callers are the two
 * return dialogs on an order, and the Operations role holds
 * `orders.cancel` without ever holding `wallet.view` — gating this on
 * the wallet would have shown that role a dialog whose fee was a dash.
 *
 * READ ONLY. There is no seller-facing writer for any of these and there
 * must not be.
 */
@ApiTags('seller-pricing')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.view')
@Controller('seller/pricing')
export class SellerPricingController {
  constructor(private readonly engine: PricingEngineService) {}

  @Get('fees')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'What a delivery and each kind of return cost this seller, priced in rupees right now.',
  })
  async fees(
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<{ items: readonly SellerFeeView[] }> {
    // One instant for all three, so two figures on one screen can never
    // be converted at two different rates.
    const at = new Date();
    const [delivery, rto, customerReturn] = await Promise.all([
      this.engine.priceDeliveryFee(seller.id, at),
      this.engine.priceRtoFee(seller.id, at),
      this.engine.priceCustomerReturnFee(seller.id, at),
    ]);
    return {
      items: [
        view('delivery', delivery),
        view('return', rto),
        view('customerReturn', customerReturn),
      ],
    };
  }
}
