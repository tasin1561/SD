import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  ResellerOrderMoneyReadService,
  type ResellerOrderMoneyView,
} from '../services/reseller-order-money-read.service';

/**
 * The seller's view of one of their reseller stores' orders: the transfer
 * price they earn, their fee shares, and when. Its own controller (not
 * the order controller, which a VIEWER may read — RBAC-1), so money is
 * closed to that role by default.
 */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.view')
@Controller('seller/orders')
export class SellerResellerOrderMoneyController {
  constructor(private readonly read: ResellerOrderMoneyReadService) {}

  @Get(':id/reseller-money')
  @ApiOperation({ summary: 'A reseller store order: your transfer price, fee shares and when' })
  money(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<ResellerOrderMoneyView> {
    return this.read.forOrder(id, { audience: 'SELLER', sellerId: seller.id });
  }
}
