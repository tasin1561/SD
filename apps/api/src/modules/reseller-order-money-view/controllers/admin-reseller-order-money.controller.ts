import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  ResellerOrderMoneyReadService,
  type ResellerOrderMoneyView,
} from '../services/reseller-order-money-read.service';

/** Staff: the full split of a reseller order — both parties, both wallets. */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders')
export class AdminResellerOrderMoneyController {
  constructor(private readonly read: ResellerOrderMoneyReadService) {}

  @Get(':id/reseller-money')
  @ApiOperation({
    summary: 'A reseller order’s money: each party’s credit, fee shares, wallet lines',
  })
  money(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<ResellerOrderMoneyView> {
    return this.read.forOrder(id, { audience: 'STAFF' });
  }
}
