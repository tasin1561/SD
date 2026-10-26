import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { CheckAddressDto, PincodeParamDto } from '../dto/address-check.dto';
import { AddressCheckService, type AddressCheckView } from '../services/address-check.service';
import { OrderPageV2GateService } from '../services/order-page-v2-gate.service';
import type { SolustationPincode } from '../types/solustation.types';

/**
 * The client console's bridge to Solustation Address.
 *
 * ── THE KEY NEVER LEAVES THE SERVER ──────────────────────────────────
 * The browser talks to its own origin, the Next route-handler proxy
 * forwards to here, and only this process holds `SOLADDR_API_KEY`
 * (FE-3). There is deliberately no endpoint that hands the key, a
 * signed URL or a pre-authorised request to the page: a key in a
 * browser is a key in every browser.
 *
 * ── EVERY ROUTE IS GATED ON THE SAME FLAG AS THE PAGE ────────────────
 * Gating only the page would leave these callable by anybody while the
 * audience is `off`, which is a live billable integration reachable by
 * a seller we never enrolled. The refusal is 404, not 403: a 403 would
 * confirm the route exists to everyone outside the pilot.
 */
@ApiTags('seller-address-check')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@Controller('seller/address-check')
export class SellerAddressCheckController {
  constructor(
    private readonly checks: AddressCheckService,
    private readonly gate: OrderPageV2GateService,
  ) {}

  /**
   * Whether this account is in the pilot.
   *
   * The ONE route here that is not itself gated — it has to be able to
   * answer "no". It reveals that a flag exists, which is not the thing
   * worth hiding: what matters is that the page is not reachable and
   * the billable endpoints 404. The page uses this to decide between
   * rendering and `notFound()`, and that hiding is COSMETIC (FE-2) —
   * the server refusing every other route is the real boundary.
   */
  @Get('enabled')
  @RequireSellerPermissions('orders.create')
  @ApiOperation({ summary: 'Whether the new order page is available to this client.' })
  async enabled(@CurrentSeller() seller: AuthenticatedSeller): Promise<{ enabled: boolean }> {
    return { enabled: await this.gate.isEnabledFor({ sellerId: seller.id }) };
  }

  @Get('pincode/:pincode')
  @RequireSellerPermissions('orders.create')
  @ApiOperation({
    summary:
      'District, state and post offices for a pincode. Free at their end. Null when the lookup is unavailable — the operator types the address as they always have.',
  })
  async pincode(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param() params: PincodeParamDto,
  ): Promise<SolustationPincode | null> {
    await this.gate.assertEnabledFor({ sellerId: seller.id });
    return this.checks.pincode(params.pincode);
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @RequireSellerPermissions('orders.create')
  @ApiOperation({
    summary:
      'Check an address. The first check for a draft goes to /v1/validate; every later one goes to /v1/corrections, because re-validating a reference returns the stored answer. A failure answers confirm_with_customer and never blocks the order.',
  })
  async check(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CheckAddressDto,
  ): Promise<AddressCheckView> {
    await this.gate.assertEnabledFor({ sellerId: seller.id });
    return this.checks.check(
      {
        actorType: ActorType.SELLER,
        // The PERSON, not the company: two users of one seller opening
        // the form are two drafts, and the draft belongs to whoever
        // opened it.
        actorId: seller.userId,
        sellerId: seller.id,
      },
      body,
    );
  }
}
