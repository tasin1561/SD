import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { CheckServiceabilityQueryDto } from '../dto/serviceability.dto';
import { OrderServiceabilityService } from '../services/order-serviceability.service';

/**
 * "Can you deliver here?", asked while the seller is still typing.
 *
 * Answered BEFORE the order is placed rather than after, which is the
 * whole point — a warning that arrives once the order exists is a
 * warning about something the seller has already committed to. It never
 * blocks: the answer may be a day stale, and a seller who knows their
 * customer's area better than a lookup does should not be stopped by it.
 *
 * Cheap to call. The underlying courier lookup is cached for a day, so
 * the first order to a new pin pays for it and the rest are free.
 */
@ApiTags('seller-serviceability')
@ApiBearerAuth()
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/serviceability')
export class SellerServiceabilityController {
  constructor(private readonly svc: OrderServiceabilityService) {}

  @Get()
  @RequireSellerPermissions('orders.view')
  @ApiOperation({
    summary:
      'Whether our courier delivers to a pincode. Advisory — a false answer never prevents an order.',
  })
  check(
    @Query() query: CheckServiceabilityQueryDto,
  ): ReturnType<OrderServiceabilityService['check']> {
    return this.svc.check({
      pincode: query.pincode,
      paymentMode: query.paymentMode,
      ...(query.codAmountInr === undefined ? {} : { codAmountInr: Number(query.codAmountInr) }),
    });
  }
}
