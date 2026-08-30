import {
  Body,
  Controller,
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
import {
  CustomerReturnService,
  type ReturnRequestResult,
} from '../services/customer-return.service';
import { RequestReturnDto } from './seller-customer-return.controller';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Staff raising the return on the seller's behalf — the call-centre
 * case, where the customer rings us rather than the seller.
 */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.cancel')
@Controller('admin/orders')
export class AdminCustomerReturnController {
  constructor(private readonly svc: CustomerReturnService) {}

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ask for a delivered order to be returned (on a seller's behalf)" })
  request(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: RequestReturnDto,
  ): Promise<ReturnRequestResult> {
    // No seller scope: staff act across sellers.
    return this.svc.request({
      orderId: id,
      sellerId: null,
      reason: body.reason,
      actorType: ActorType.STAFF,
      actorId: staff.id,
    });
  }
}
