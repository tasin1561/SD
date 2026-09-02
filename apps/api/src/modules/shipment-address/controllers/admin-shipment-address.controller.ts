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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ChangeConsigneeDto } from '../dto/change-address.dto';
import { ShipmentAddressService } from '../services/shipment-address.service';

/**
 * The same correction, from our side.
 *
 * Unscoped: an operator acts across sellers. Everything else — the
 * status window, the audit row, the verification — is identical, because
 * it is the same physical parcel and the courier does not care who asked.
 */
@ApiTags('admin-orders')
@ApiBearerAuth()
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/orders')
export class AdminShipmentAddressController {
  constructor(private readonly svc: ShipmentAddressService) {}

  @Get(':orderId/consignee')
  @RequirePermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'What the courier has, and whether they will still accept a change.' })
  editability(
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<ShipmentAddressService['editability']> {
    return this.svc.editability(orderId, null);
  }

  @Get(':orderId/consignee/history')
  @RequirePermissions('orders.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Every change made to this parcel — who, when, and whether it landed.' })
  history(
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
  ): ReturnType<ShipmentAddressService['history']> {
    return this.svc.history(orderId, null);
  }

  @Post(':orderId/consignee')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Correct the name, phone or street address with the courier.' })
  change(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: ChangeConsigneeDto,
  ): ReturnType<ShipmentAddressService['change']> {
    return this.svc.change({
      orderId,
      sellerId: null,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.addressLine1 === undefined ? {} : { addressLine1: body.addressLine1 }),
      actor: { type: ActorType.STAFF, staffId: staff.id },
    });
  }
}
