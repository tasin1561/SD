import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import { PickExpirationService, type PickExpireResult } from '../services/pick-expiration.service';

/**
 * Supervisor pick-ops endpoints. Manual WMS-5 expiry trigger for stuck
 * picks (the BullMQ-driven sweep is the primary path; this is the
 * supervisor escape hatch). WAREHOUSE_SUPERVISOR or SUPER_ADMIN.
 */
@ApiTags('admin-warehouse-pick')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/warehouse/picks')
export class AdminPickController {
  constructor(private readonly expiration: PickExpirationService) {}

  @Post(':shipmentId/expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manually release a stuck pick claim (WMS-5 supervisor override). Idempotent — same time-based CAS as the BullMQ-driven path',
  })
  async forceExpire(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<PickExpireResult> {
    requireStaffRoles(staff, [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.SUPER_ADMIN]);
    return this.expiration.forceExpire(shipmentId);
  }
}
