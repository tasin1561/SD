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
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import type { AddressCheckView } from '../services/address-check.service';
import { OrderAddressCheckReadService } from '../services/order-address-check-read.service';

/**
 * A CLIENT reading the stored address check on one of its own orders.
 *
 * Display only. There is no check, no re-check and no apply here — the
 * billable routes live on `SellerAddressCheckController` behind the
 * pilot flag, and this one spends nothing because it reads the row the
 * order already carries.
 *
 * `orders.view`, the same key as the rest of the order's facts: a
 * verdict about where a parcel is going is part of reading the order,
 * not a separate privilege. Deliberately NOT gated on the order-page
 * pilot flag — the backfill sweep writes a check for every India order
 * whichever console placed it, so gating the READ would hide a fact
 * about the seller's own parcel for a reason that only concerns who may
 * spend money at the vendor.
 */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/orders')
export class SellerOrderAddressCheckController {
  constructor(private readonly reads: OrderAddressCheckReadService) {}

  @Get(':orderId/address-check')
  @RequireSellerPermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The stored address check for one of your orders (404 when it has none).',
  })
  async get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): Promise<AddressCheckView> {
    const view = await this.reads.forSeller(orderId, seller.id);
    // An order that is not this seller's reads exactly like an order
    // with no check — see the service note.
    if (view === null) throw new NotFoundException('No address check for this order');
    return view;
  }
}
