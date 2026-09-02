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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { ChangeConsigneeDto } from '../dto/change-address.dto';
import { ShipmentAddressService } from '../services/shipment-address.service';

@ApiTags('seller-orders')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@Controller('seller/orders')
export class SellerShipmentAddressController {
  constructor(private readonly svc: ShipmentAddressService) {}

  @Get(':orderId/consignee')
  @RequireSellerPermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'What the courier currently has for this parcel, and whether they will still accept a correction.',
  })
  editability(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<ShipmentAddressService['editability']> {
    return this.svc.editability(orderId, seller.id);
  }

  @Get(':orderId/consignee/history')
  @RequireSellerPermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Every change made to this parcel, and whether the courier took it.' })
  history(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<ShipmentAddressService['history']> {
    return this.svc.history(orderId, seller.id);
  }

  @Post(':orderId/consignee')
  // Same permission as placing the order: whoever may commit the company
  // to a delivery is who may change where it goes.
  @RequireSellerPermissions('orders.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Correct the name, phone or street address with the courier. Refused once the parcel is past the point they accept changes.',
  })
  change(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: ChangeConsigneeDto,
  ): ReturnType<ShipmentAddressService['change']> {
    return this.svc.change({
      orderId,
      sellerId: seller.id,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.addressLine1 === undefined ? {} : { addressLine1: body.addressLine1 }),
      actor: { type: ActorType.SELLER, sellerId: seller.id },
    });
  }
}
