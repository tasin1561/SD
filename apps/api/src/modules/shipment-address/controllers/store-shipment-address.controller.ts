import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType, ResellerStoreActionMode } from '@skydrop/db';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import { ChangeConsigneeDto } from '../dto/change-address.dto';
import { ShipmentAddressService } from '../services/shipment-address.service';

/**
 * A reseller STORE correcting the consignee on a parcel already with the
 * courier (owner, 2026-09-18: "edit after confirmation … but only if our
 * main system allows it whatever the case is").
 *
 * The same service seller staff use, so the courier's word is the answer
 * for both and neither can write an address the parcel is not going to.
 * Scoped to the store's OWN order in the WHERE clause (RS-2).
 *
 * ── THE SELLER'S SWITCH STILL GOVERNS IT ─────────────────────────────
 * `policy.orderChange` OFF refuses. DIRECT goes to the courier now.
 * ASK_SELLER is also refused HERE, by name, and says who does it instead
 * — deliberately, and it is the one place the store's post-handover
 * reach is narrower than its pre-handover one: a held request is applied
 * by seller staff hours or a day later, and by then the courier's own
 * window (`COURIER_EDITABLE_SHIPMENT_STATUSES`) may have closed. Holding
 * it would mean an approval that silently does nothing to a moving
 * parcel while both parties believe the address changed. Seller staff
 * make the change themselves, immediately, from the order.
 */
@ApiTags('store-orders')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@Controller('store/orders')
export class StoreShipmentAddressController {
  constructor(
    private readonly svc: ShipmentAddressService,
    private readonly policies: ResellerStoreActionPolicyService,
  ) {}

  @Get(':orderId/consignee')
  @RequireStorePermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'What the courier currently has for this parcel, and whether they will still accept a correction.',
  })
  editability(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<ShipmentAddressService['editability']> {
    return this.svc.editability(orderId, user.sellerId, user.storeId);
  }

  @Get(':orderId/consignee/history')
  @RequireStorePermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Every change made to this parcel, and whether the courier took it.' })
  history(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<ShipmentAddressService['history']> {
    return this.svc.history(orderId, user.sellerId, user.storeId);
  }

  @Post(':orderId/consignee')
  // The same permission as changing the order before it ships: whoever
  // may commit the store to a delivery is who may change where it goes.
  @RequireStorePermissions('orders.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask the courier to correct the name, phone or street address. Stored only if they accept it.',
  })
  async change(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: ChangeConsigneeDto,
  ): ReturnType<ShipmentAddressService['change']> {
    const policy = await this.policies.forStore(user.storeId);
    if (policy.orderChange === ResellerStoreActionMode.OFF) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          'The seller has not enabled changes to orders for this store. Ask them to make the change.',
      });
    }
    if (policy.orderChange === ResellerStoreActionMode.ASK_SELLER) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NEEDS_SELLER_NOW',
        message:
          'This parcel is already with the courier, and your seller approves changes to this store’s ' +
          'orders before they happen. A change held for approval could miss the courier’s window ' +
          'entirely, so ask the seller to make this one themselves — now, while the courier will ' +
          'still take it.',
      });
    }
    return this.svc.change({
      orderId,
      sellerId: user.sellerId,
      storeId: user.storeId,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.addressLine1 === undefined ? {} : { addressLine1: body.addressLine1 }),
      actor: { type: ActorType.STORE, sellerId: user.sellerId, storeUserId: user.id },
    });
  }
}
