import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { AddressCheckService, type AddressCheckView } from '../services/address-check.service';

/**
 * Staff's view of the stored address check for an order, and the one
 * reason to ask again: the address was EDITED.
 *
 * The GET never calls the vendor — the projection is built from the
 * persisted row. The POST does, and only because an edited address
 * makes the stored verdict wrong rather than stale. Shadow mode still
 * holds for both: they report, they never gate an order.
 */
@ApiTags('admin-address-check')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders')
export class AdminAddressCheckController {
  constructor(private readonly checks: AddressCheckService) {}

  // A call agent holds `callcenter.work` and need not hold `orders.view`
  // — and the call bench is where this verdict matters most, because the
  // customer who knows the address is on the line. Reading it is the
  // same read either way.
  @Get(':id/address-check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('orders.view', 'callcenter.work')
  @ApiOperation({ summary: 'The stored address check for an order (404 when it has none)' })
  async get(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<AddressCheckView> {
    const view = await this.checks.storedViewForOrder(id);
    if (view === null) throw new NotFoundException('No address check for this order');
    return view;
  }

  /**
   * Re-check this order's address and REPLACE the stored verdict.
   *
   * For an address somebody has just edited — the agent on a
   * confirmation call being the case it was built for. It is its own
   * request, made after the edit is committed, so it cannot refuse,
   * reverse or delay that edit; a vendor failure answers with the
   * `unavailable` view and stores the same, which is why this never
   * surfaces a 5xx of theirs as one of ours.
   *
   * 404 only for an order that does not exist or is not an India one —
   * never for "the check failed".
   */
  @Post(':id/address-check/recheck')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('callcenter.work', 'orders.override')
  @ApiOperation({ summary: 'Re-check an edited order address, replacing the stored verdict' })
  async recheck(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<AddressCheckView> {
    const view = await this.checks.recheckOrder(id);
    if (view === null) throw new NotFoundException('This order has no address to check');
    return view;
  }
}
