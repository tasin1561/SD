import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  SellerRestrictionService,
  type ActiveRestriction,
} from '../services/seller-restriction.service';

/**
 * What the banner reads.
 *
 * Gated on `profile.view` — a hold is account state.
 *
 * That covers every role that can actually TRIP one: owner, admin, ops,
 * inventory and finance. VIEWER holds only `orders.view` and can create,
 * confirm and withdraw nothing, so it has no blocked action to be
 * confused by; showing it a banner about a wall it cannot walk into
 * would be noise.
 *
 * SellerAuthAllowSuspended for the same reason the wallet is — the one
 * page a restricted account must always reach is the one explaining how
 * to stop being restricted.
 */
@ApiTags('seller-restriction')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('profile.view')
@Controller('seller/restriction')
export class SellerRestrictionController {
  constructor(private readonly svc: SellerRestrictionService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The hold on this account, if any' })
  active(@CurrentSeller() seller: AuthenticatedSeller): Promise<ActiveRestriction | null> {
    return this.svc.activeFor(seller.id);
  }
}
