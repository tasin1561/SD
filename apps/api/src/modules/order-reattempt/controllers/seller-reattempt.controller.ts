import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  OrderReattemptService,
  type ReattemptRequestView,
} from '../services/order-reattempt.service';
import { CreateReattemptRequestDto } from '../dto/order-reattempt.dto';

/**
 * Lives in THIS module rather than on SellerOrderController, which is
 * where the route would naturally sit: `order-reattempt` imports
 * OrderModule for the read and write boundaries, so having an order
 * controller call back into this service would close a cycle. Same
 * answer the R3 rule gives everywhere else — put it on the side that
 * already depends on the other.
 *
 * `orders.create` is the permission: none of the existing keys is an
 * exact fit, and whoever may place and amend an order is the closest
 * thing to whoever may ask for one more call on it. `orders.cancel` is
 * the opposite act.
 */
@ApiTags('seller-order-reattempt')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/orders')
export class SellerReattemptController {
  constructor(private readonly svc: OrderReattemptService) {}

  @Post(':orderId/reattempt-request')
  @RequireSellerPermissions('orders.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ask for one more call on an order the customer declined (an admin decides)',
  })
  request(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: CreateReattemptRequestDto,
  ): Promise<ReattemptRequestView> {
    return this.svc.request({
      sellerId: seller.id,
      orderId,
      reason: body.reason,
      sellerUserId: seller.userId,
    });
  }

  @Get(':orderId/reattempt-requests')
  @RequireSellerPermissions('orders.view')
  @ApiOperation({
    summary: 'This order’s re-attempt requests, and whether another may be raised',
  })
  // Returns `canRequest` rather than leaving the UI to decide from the
  // status: which statuses qualify is a SETTING now, per seller, and a
  // client that made its own guess would show a button on an order the
  // server refuses (FE-2 — the server is the boundary).
  listForOrder(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): Promise<{ requests: ReattemptRequestView[]; canRequest: boolean }> {
    return this.svc.listForOrderWithEligibility(seller.id, orderId);
  }
}
