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
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { CheckAddressDto, PincodeParamDto } from '../dto/address-check.dto';
import { AddressCheckService, type AddressCheckView } from '../services/address-check.service';
import { OrderPageV2GateService } from '../services/order-page-v2-gate.service';
import type { SolustationPincode } from '../types/solustation.types';

/**
 * The member-store and associate consoles' bridge to Solustation.
 *
 * ONE controller for both, because both consoles already place orders
 * through `POST /store/orders` — they are two front ends on one store
 * identity, and giving the address check a third path would be a second
 * answer to the same question. An associate is a store user with a
 * narrower order scope, which changes what they may READ, not who the
 * store is.
 *
 * Same rules as the client console's: the key never leaves the server
 * (FE-3), every route is gated on the audience flag, and the refusal is
 * 404 rather than 403 so the route's existence is not advertised to
 * stores outside the pilot.
 */
@ApiTags('store-address-check')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@Controller('store/address-check')
export class StoreAddressCheckController {
  constructor(
    private readonly checks: AddressCheckService,
    private readonly gate: OrderPageV2GateService,
  ) {}

  /** Whether this store (or this associate) is in the pilot. The one
   *  route not gated on the flag — it has to be able to answer "no".
   *  See the client controller for why that is safe. */
  @Get('enabled')
  @RequireStorePermissions('orders.create')
  @ApiOperation({ summary: 'Whether the new order page is available here.' })
  async enabled(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<{ enabled: boolean }> {
    return { enabled: await this.gate.isEnabledFor(this.identity(user)) };
  }

  @Get('pincode/:pincode')
  @RequireStorePermissions('orders.create')
  @ApiOperation({
    summary:
      'District, state and post offices for a pincode. Free at their end. Null when unavailable.',
  })
  async pincode(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param() params: PincodeParamDto,
  ): Promise<SolustationPincode | null> {
    await this.gate.assertEnabledFor(this.identity(user));
    return this.checks.pincode(params.pincode);
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @RequireStorePermissions('orders.create')
  @ApiOperation({
    summary:
      'Check an address. First check validates, later ones correct. A failure answers confirm_with_customer and never blocks the order.',
  })
  async check(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: CheckAddressDto,
  ): Promise<AddressCheckView> {
    await this.gate.assertEnabledFor(this.identity(user));
    return this.checks.check(
      {
        actorType: ActorType.STORE,
        // The store USER: an associate's draft is their own, and the
        // store may have several people on the form at once.
        actorId: user.id,
        sellerId: user.sellerId,
        storeId: user.storeId,
      },
      body,
    );
  }

  /** All three ids, because the pilot list may name any of them — the
   *  store for a whole member store, the user for one associate. */
  private identity(user: AuthenticatedStoreUser): {
    sellerId: string;
    storeId: string;
    storeUserId: string;
  } {
    return { sellerId: user.sellerId, storeId: user.storeId, storeUserId: user.id };
  }
}
