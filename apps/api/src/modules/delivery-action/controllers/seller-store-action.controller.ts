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
  BadRequestException,
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
import { DecideDeliveryActionDto } from '../dto/delivery-action.dto';
import { SellerStoreActionDecisionService } from '../services/seller-store-action-decision.service';
import type { DeliveryActionRequestView } from '../services/delivery-action.service';

/**
 * The seller's queue: what their reseller stores are waiting on
 * (2026-09-16, owner).
 *
 * Only the asks their own policy marked "ask me first" stop here. The
 * ones they set to go straight through never appear — they already ran.
 *
 * `stores.manage` because this is the same authority as the rest of
 * running a store: a decision about somebody else's business, made on
 * the seller's goods.
 */
@ApiTags('seller-reseller-stores')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.manage')
@Controller('seller/store-action-requests')
export class SellerStoreActionController {
  constructor(private readonly svc: SellerStoreActionDecisionService) {}

  @Get()
  @ApiOperation({ summary: 'What your stores are waiting on, oldest first' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly unknown[]> {
    return this.svc.listPending(seller.id);
  }

  @Post(':requestId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Say yes, and it runs — the same way it would have if you had let it through',
  })
  approve(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideDeliveryActionDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<DeliveryActionRequestView> {
    return this.svc.approve(seller, requestId, body.note ?? null, ctx);
  }

  @Post(':requestId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say no. The reason is shown to the store.' })
  reject(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideDeliveryActionDto,
  ): Promise<DeliveryActionRequestView> {
    const note = body.note?.trim() ?? '';
    if (note === '') {
      // The store reads this. A refusal with nothing in it is a dead end
      // for whoever has to go back to the customer.
      throw new BadRequestException({
        code: 'DELIVERY_ACTION_REASON_REQUIRED',
        message: 'Tell the store why — they have a customer waiting on this answer.',
      });
    }
    return this.svc.reject(seller, requestId, note);
  }
}
