import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { CapacityService, type CapacityReport } from '../services/capacity.service';

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
@Controller('admin/system')
export class AdminCapacityController {
  constructor(private readonly capacity: CapacityService) {}

  @Get('capacity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Live capacity: what is running out, how fast, and what to do about it',
  })
  report(@CurrentStaff() staff: AuthenticatedStaff): Promise<CapacityReport> {
    requireStaffRoles(staff, [StaffRole.SUPER_ADMIN]);
    return this.capacity.report();
  }
}
