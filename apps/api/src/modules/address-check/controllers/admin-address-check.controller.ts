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
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { AddressCheckService, type AddressCheckView } from '../services/address-check.service';

/**
 * Staff's READ-ONLY view of the stored address check for an order.
 * Shadow mode: it reports, it never acts, and it never calls the
 * vendor — the projection is built from the persisted row.
 */
@ApiTags('admin-address-check')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders')
export class AdminAddressCheckController {
  constructor(private readonly checks: AddressCheckService) {}

  @Get(':id/address-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The stored address check for an order (404 when it has none)' })
  async get(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<AddressCheckView> {
    const view = await this.checks.storedViewForOrder(id);
    if (view === null) throw new NotFoundException('No address check for this order');
    return view;
  }
}
