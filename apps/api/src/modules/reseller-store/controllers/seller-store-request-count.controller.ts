import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  SellerStoreRequestCountService,
  type StoreRequestCount,
} from '../services/seller-store-request-count.service';

/**
 * How many asks from this seller's reseller stores are waiting on them —
 * BOTH queues, in one number (2026-09-16).
 *
 * Its OWN path rather than a handler on `seller/reseller-stores`: that
 * controller's routes are all `:storeId`-shaped, and a literal segment
 * sharing a prefix with a param route is resolved by declaration order,
 * which is a fragile thing to depend on for a route people will keep
 * adding siblings to.
 *
 * `stores.manage`, the same as both queues it counts and the same as the
 * page it badges — a number about somebody else's business is the same
 * authority as the rest of running one. The seller comes from the TOKEN
 * (RBAC-1); no seller id appears in the path.
 */
@ApiTags('seller-reseller-stores')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.manage')
@Controller('seller/store-requests')
export class SellerStoreRequestCountController {
  constructor(private readonly counts: SellerStoreRequestCountService) {}

  @Get('count')
  @ApiOperation({
    summary:
      'How many things your reseller stores are waiting on you for — delivery asks and address ' +
      'corrections together, for the nav badge',
  })
  count(@CurrentSeller() seller: AuthenticatedSeller): Promise<StoreRequestCount> {
    return this.counts.forSeller(seller.id);
  }
}
