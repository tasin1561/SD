import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  CourierWhatsappReadService,
  type CourierWhatsappView,
} from '../services/courier-whatsapp-read.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/** Client (seller): its own orders; another seller's is a 404. */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.view')
@Controller('seller/orders')
export class SellerCourierWhatsappController {
  constructor(private readonly read: CourierWhatsappReadService) {}

  @Get(':id/courier-messages')
  @ApiOperation({ summary: 'WhatsApp messages the courier sent the customer' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<CourierWhatsappView> {
    return this.read.forOrder(id, { sellerId: seller.id });
  }
}
