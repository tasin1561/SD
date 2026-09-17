import {
  BadRequestException,
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
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { DecideDeliveryActionDto } from '../../delivery-action/dto/delivery-action.dto';
import type { StoreOrderRequestView } from '../../store-order-request/services/store-order-request.service';
import { SellerStoreOrderRequestDecisionService } from '../services/seller-store-order-request-decision.service';

/**
 * Seller staff's queue of a reseller store's held cancel, call-cap answer
 * and issue with Skydrop (2026-09-17). A sibling of
 * `/seller/store-action-requests` and `/seller/store-address-changes`;
 * one page in apps/seller calls all three.
 */
@ApiTags('seller-reseller-stores')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.manage')
@Controller('seller/store-order-requests')
export class SellerStoreOrderRequestController {
  constructor(private readonly svc: SellerStoreOrderRequestDecisionService) {}

  @Get()
  @ApiOperation({ summary: 'Cancels, call-cap answers and issues your stores are waiting on' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly unknown[]> {
    return this.svc.listPending(seller.id);
  }

  @Post(':requestId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Say yes, and it runs as the store asked. The reply says what actually happened.',
  })
  approve(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideDeliveryActionDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StoreOrderRequestView> {
    return this.svc.approve(seller, requestId, body.note ?? null, ctx);
  }

  @Post(':requestId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say no. The reason is emailed to the store.' })
  reject(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideDeliveryActionDto,
  ): Promise<StoreOrderRequestView> {
    const note = body.note?.trim() ?? '';
    if (note === '') {
      throw new BadRequestException({
        code: 'STORE_REQUEST_REASON_REQUIRED',
        message: 'Tell the store why — they have a customer waiting on this answer.',
      });
    }
    return this.svc.reject(seller, requestId, note);
  }
}
