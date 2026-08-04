import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { OrderChargesService, type OrderChargeView } from '../services/order-charges.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('seller-order-charges')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('charges.view')
@Controller('seller/orders/:orderId/charges')
export class SellerOrderChargesController {
  constructor(private readonly svc: OrderChargesService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List charges for an order (seller scope, isVisibleToSeller=true only)',
  })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', uuid()) orderId: string,
  ): Promise<readonly OrderChargeView[]> {
    return this.svc.listForOrderSeller(seller.id, orderId);
  }
}
