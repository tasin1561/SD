import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { CapacityService, type CapacityReport } from '../services/capacity.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * The capacity monitor's data.
 *
 * Restricted to SUPER_ADMIN: it reports connection counts, storage
 * headroom and queue depth, which together describe how to bring the
 * platform down. It is also the page someone reads at three in the
 * morning, so it is a plain GET with no parameters — nothing to get
 * wrong while worried.
 */
@ApiTags('admin-system')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('system.capacity.view')
@Controller('admin/system')
export class AdminCapacityController {
  constructor(private readonly capacity: CapacityService) {}

  @Get('capacity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Live capacity: what is running out, how fast, and what to do about it',
  })
  report(): Promise<CapacityReport> {
    return this.capacity.report();
  }
}
