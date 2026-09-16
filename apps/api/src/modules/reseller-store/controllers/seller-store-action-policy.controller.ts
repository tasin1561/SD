import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { SetStoreActionPolicyDto } from '../dto/reseller-store.dto';
import {
  ResellerStoreActionPolicyService,
  type ActionPolicyView,
} from '../services/reseller-store-action-policy.service';

/**
 * What one reseller store may do about an order on its own (2026-09-16).
 *
 * The seller's rule about somebody else's business, so it sits behind
 * `stores.manage` exactly as the rest of the store's settings do — and in
 * its own controller because it is a different question from the store's
 * lifecycle, not because the guard differs.
 *
 * The store id is a parameter but the SELLER is the token's: a store that
 * is not theirs is a 404 that says nothing about whether it exists.
 */
@ApiTags('seller-reseller-stores')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.manage')
@Controller('seller/reseller-stores')
export class SellerStoreActionPolicyController {
  constructor(private readonly policy: ResellerStoreActionPolicyService) {}

  @Get(':storeId/action-policy')
  @ApiOperation({
    summary: 'What this store may do on its own, and what needs your approval',
  })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<ActionPolicyView> {
    return this.policy.getForSeller(seller.id, storeId);
  }

  @Put(':storeId/action-policy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set the whole policy — every capability, so nothing is left ambiguous',
  })
  set(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: SetStoreActionPolicyDto,
  ): Promise<ActionPolicyView> {
    return this.policy.setPolicy(seller, storeId, body);
  }
}
