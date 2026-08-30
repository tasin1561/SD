import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  CustomerReturnService,
  type ReturnRequestResult,
} from '../services/customer-return.service';

export class RequestReturnDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The seller asks for a delivered parcel back.
 *
 * Gated on `orders.cancel` rather than a read permission: it commits
 * the seller to a second delivery charge and puts stock back on the
 * shelf. Whoever may call off an order may also call one back.
 */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.cancel')
@Controller('seller/orders')
export class SellerCustomerReturnController {
  constructor(private readonly svc: CustomerReturnService) {}

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask for a delivered order to be returned to the warehouse' })
  request(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: RequestReturnDto,
  ): Promise<ReturnRequestResult> {
    return this.svc.request({
      orderId: id,
      // Scoped in the query, so another seller's order is a not-found
      // rather than a refusal that confirms it exists.
      sellerId: seller.id,
      reason: body.reason,
      actorType: ActorType.SELLER,
      actorId: seller.id,
    });
  }
}
