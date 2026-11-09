import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import type { AddressCheckView } from '../services/address-check.service';
import { OrderAddressCheckReadService } from '../services/order-address-check-read.service';

/**
 * A MEMBER STORE or an ASSOCIATE reading the stored address check on
 * one of its own orders.
 *
 * ONE controller for both consoles, for the same reason the check
 * endpoints are one: they are two front ends on one store identity. An
 * associate is a store user with a narrower order scope, which changes
 * WHICH orders answer (ASSOC-1) rather than who the store is — and that
 * narrowing is in the WHERE clause, not here.
 *
 * Display only, `orders.view`, and not gated on the order-page pilot
 * flag: see the client controller for why the READ is not where that
 * flag belongs.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@Controller('store/orders')
export class StoreOrderAddressCheckController {
  constructor(private readonly reads: OrderAddressCheckReadService) {}

  @Get(':orderId/address-check')
  @RequireStorePermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The stored address check for one of your orders (404 when it has none).',
  })
  async get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): Promise<AddressCheckView> {
    const view = await this.reads.forStore(orderId, {
      sellerId: user.sellerId,
      storeId: user.storeId,
      storeUserId: user.id,
      orderScope: user.orderScope,
    });
    // Another store's order, a colleague's order an associate may not
    // see, and an order with no check are all the same 404.
    if (view === null) throw new NotFoundException('No address check for this order');
    return view;
  }
}
