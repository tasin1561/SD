import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { StoreOrdersService, viewerFor } from '../../reseller-order/services/store-orders.service';
import {
  CourierWhatsappReadService,
  type CourierWhatsappView,
} from '../services/courier-whatsapp-read.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Member store and associate (one portal API). Ownership is decided by
 * the store's own order read — `StoreOrdersService.events` runs
 * `assertOwned(storeId, viewer, id)`, which already scopes an associate
 * to their own orders — so the rule is never re-implemented here.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.view')
@Controller('store/orders')
export class StoreCourierWhatsappController {
  constructor(
    private readonly read: CourierWhatsappReadService,
    private readonly orders: StoreOrdersService,
  ) {}

  @Get(':id/courier-messages')
  @ApiOperation({ summary: 'WhatsApp messages the courier sent the customer' })
  async get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<CourierWhatsappView> {
    await this.orders.events(user.storeId, viewerFor(user), id); // 404 when not theirs
    return this.read.forProvenOrder(id);
  }
}
