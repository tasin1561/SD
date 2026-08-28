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
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { RequestDeliveryActionDto } from '../dto/delivery-action.dto';
import { DeliveryActionService } from '../services/delivery-action.service';
import { SellerCallHistoryService } from '../services/seller-call-history.service';

/**
 * What a seller can ask for when a delivery fails.
 *
 * Reading needs `orders.view` — a failed delivery is something anyone
 * watching the account should see. ASKING needs `orders.create`: a
 * re-attempt costs money and an RTO ends the sale, so it sits with
 * whoever may commit the company to a delivery in the first place.
 */
@ApiTags('seller-delivery-actions')
@ApiBearerAuth()
@UseGuards(SellerJwtGuard)
@Controller('seller/orders')
export class SellerDeliveryActionController {
  constructor(
    private readonly svc: DeliveryActionService,
    private readonly calls: SellerCallHistoryService,
  ) {}

  @Get(':orderId/call-history')
  @RequireSellerPermissions('orders.view')
  @ApiOperation({
    summary:
      'What we said to the customer — outcome, notes and anything they corrected. The agent is not named.',
  })
  callHistory(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<SellerCallHistoryService['forOrder']> {
    return this.calls.forOrder(seller.id, orderId);
  }

  @Get(':orderId/delivery-actions')
  @RequireSellerPermissions('orders.view')
  @ApiOperation({
    summary: 'What has been asked for on this order, and whether another request may be raised',
  })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<DeliveryActionService['listForOrder']> {
    return this.svc.listForOrder(seller.id, orderId);
  }

  @Post(':orderId/delivery-actions')
  // Same permission as placing an order: whoever may commit the company
  // to a delivery is who may ask for another attempt at one. A viewer
  // can see the failure and what was said; they cannot spend money on it.
  @RequireSellerPermissions('orders.create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Ask us to re-attempt, call the customer, or send it back. An operator decides — nothing reaches the courier from here.',
  })
  request(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: RequestDeliveryActionDto,
  ): ReturnType<DeliveryActionService['request']> {
    return this.svc.request({
      sellerId: seller.id,
      sellerUserId: seller.userId,
      orderId,
      action: body.action,
      reason: body.reason,
    });
  }
}
