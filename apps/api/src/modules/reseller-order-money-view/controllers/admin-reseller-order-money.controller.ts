import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  ResellerOrderMoneyReadService,
  type ResellerOrderMoneyView,
} from '../services/reseller-order-money-read.service';

/**
 * Staff: the full split of a reseller order — both parties, both wallets.
 *
 * ── AN OPEN QUESTION, STATED SO IT IS NOT ASSUMED SETTLED ───────────
 * This is `orders.view`, which on the staff side is held by `call_agent`,
 * `warehouse_staff`, `warehouse_supervisor`, `manual_placement_admin`
 * and `finance` — so a picker and a call agent can read a store's
 * transfer price and a seller's credit. The SELLER twin was moved off
 * `orders.view` onto `stores.order_money.view` (2026-10-05) because a
 * seller's junior staff seeing their own company's margin is a clear
 * mistake; Skydrop staff seeing it is a different question and has NOT
 * been decided.
 *
 * If it is ever narrowed, `orders.charges.view` needs no new key and
 * already resolves to the right set — finance, super admins, Admin and
 * Read-only — losing it for the warehouse and call-centre roles, which
 * is the whole point.
 */
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
