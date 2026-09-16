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
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { RequestDeliveryActionDto } from '../dto/delivery-action.dto';
import {
  StoreDeliveryActionService,
  type StoreActionOutcome,
} from '../services/store-delivery-action.service';

/**
 * What a reseller store can ask for about one of its own live orders
 * (2026-09-16, owner).
 *
 * Whether an ask goes straight through or waits for the seller is the
 * SELLER's policy for this store — not this controller's business. The
 * store id comes from the TOKEN, so another store's order is a 404.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.actions')
@Controller('store/orders')
export class StoreDeliveryActionController {
  constructor(private readonly svc: StoreDeliveryActionService) {}

  @Get(':orderId/actions')
  @ApiOperation({
    summary: 'What this store has asked for on the order, and what it is allowed to ask',
  })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<StoreDeliveryActionService['listForOrder']> {
    return this.svc.listForOrder(user.storeId, orderId);
  }

  @Post(':orderId/actions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Ask for the customer to be called again, another delivery attempt, or the parcel back. Runs now or waits for the seller, per their policy.',
  })
  request(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: RequestDeliveryActionDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StoreActionOutcome> {
    return this.svc.request({
      storeId: user.storeId,
      storeUserId: user.id,
      orderId,
      action: body.action,
      reason: body.reason,
      ctx,
    });
  }
}
