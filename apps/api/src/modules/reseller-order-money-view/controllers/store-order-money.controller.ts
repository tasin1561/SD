import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  ResellerOrderMoneyReadService,
  type ResellerOrderMoneyView,
} from '../services/reseller-order-money-read.service';

/** The store's own order: what it pays and earns on it, and when. */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.view')
@Controller('store/orders')
export class StoreOrderMoneyController {
  constructor(private readonly read: ResellerOrderMoneyReadService) {}

  @Get(':id/money')
  @ApiOperation({ summary: 'What this order pays the store and the seller, and when' })
  money(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<ResellerOrderMoneyView> {
    return this.read.forOrder(id, { audience: 'STORE', storeId: user.storeId });
  }
}
