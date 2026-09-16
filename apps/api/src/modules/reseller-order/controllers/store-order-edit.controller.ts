import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ResellerStoreActionMode } from '@skydrop/db';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { StoreEditRecipientDto } from '../dto/address-change.dto';
import {
  StoreOrderEditService,
  type StoreRecipientEditOutcome,
} from '../services/store-order-edit.service';
import type { AddressChangeRequestView } from '../services/store-address-change.service';

/**
 * 2026-09-16 — a reseller store correcting where its own parcel is going.
 *
 * Its own controller so the gate list pinned on `StoreOrderController` by
 * `store-permission-surface.spec.ts` stays as it is; the concern is also
 * genuinely different from placing and cancelling.
 *
 * The DTO extends the SELLER's `UpdateOrderDto` on purpose — one shape
 * for one order — and the service refuses every field outside the
 * recipient block by name (`STORE_EDIT_RECIPIENT_ONLY`) rather than
 * ignoring it, so a store that sends more finds out instead of believing
 * it worked. The one field that is NOT the order's is `reason`, which
 * belongs to a held correction and is stripped before the patch is
 * applied.
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
      'Correct where the parcel is going, before it is confirmed. Recipient fields only; anything ' +
      'else is refused by name. Depending on the seller’s policy this is applied at once or held ' +
      'for them to approve — the answer says which.',
  })
  editRecipient(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: StoreEditRecipientDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StoreRecipientEditOutcome> {
    return this.edits.editRecipient({
      storeId: user.storeId,
      storeUserId: user.id,
      sellerId: user.sellerId,
      orderId,
      patch: body,
      ctx: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: null },
    });
  }

  @Get(':orderId/address-changes')
  @ApiOperation({
    summary:
      'Corrections asked for on this order, and whether this store may correct an address at all',
  })
  listAddressChanges(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): Promise<{ items: readonly AddressChangeRequestView[]; mode: ResellerStoreActionMode }> {
    return this.edits.listAddressChanges(user.storeId, orderId);
  }
}
