import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { UpdateOrderDto } from '../../order/dto/update-order.dto';
import { StoreOrderEditService } from '../services/store-order-edit.service';
import type { StoreOrderView } from '../services/store-orders.service';

/**
 * 2026-09-16 — a reseller store correcting where its own parcel is going.
 *
 * Its own controller so the gate list pinned on `StoreOrderController` by
 * `store-permission-surface.spec.ts` stays as it is; the concern is also
 * genuinely different from placing and cancelling.
 *
 * The DTO is the SELLER's `UpdateOrderDto` on purpose — one shape for one
 * order — and the service refuses every field outside the recipient block
 * by name (`STORE_EDIT_RECIPIENT_ONLY`) rather than ignoring it, so a
 * store that sends more finds out instead of believing it worked.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.actions')
@Controller('store/orders')
export class StoreOrderEditController {
  constructor(private readonly edits: StoreOrderEditService) {}

  @Patch(':orderId/recipient')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Correct where the parcel is going, before it is confirmed. Recipient fields only; anything else is refused by name.',
  })
  editRecipient(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: UpdateOrderDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StoreOrderView> {
    return this.edits.editRecipient({
      storeId: user.storeId,
      storeUserId: user.id,
      sellerId: user.sellerId,
      orderId,
      patch: body,
      ctx: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: null },
    });
  }
}
