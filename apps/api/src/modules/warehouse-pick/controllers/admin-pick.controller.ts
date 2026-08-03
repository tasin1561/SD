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

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { PickExpirationService, type PickExpireResult } from '../services/pick-expiration.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Supervisor pick-ops endpoints. Manual WMS-5 expiry trigger for stuck
 * picks (the BullMQ-driven sweep is the primary path; this is the
 * supervisor escape hatch). WAREHOUSE_SUPERVISOR or SUPER_ADMIN.
 */
@ApiTags('admin-warehouse-pick')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.pick.supervise')
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
  ): Promise<PickExpireResult> {
    return this.expiration.forceExpire(shipmentId);
  }
}
