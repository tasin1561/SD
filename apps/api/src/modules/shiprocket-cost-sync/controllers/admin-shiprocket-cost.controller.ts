import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  ShiprocketCostPanelService,
  type ShiprocketCostPanel,
} from '../services/shiprocket-cost-panel.service';
import { ShiprocketCostSyncQueue } from '../queue/shiprocket-cost-sync.queue';

/**
 * Shiprocket's side of /cost-sync.
 *
 * The same two permissions as the Delhivery sync: reading it is
 * `courier.accounts.view`; running it is `courier.accounts.manage`,
 * because a run is a burst of real calls against a courier's account.
 */
@ApiTags('admin-shiprocket-cost')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@Controller('admin/courier-cost/shiprocket')
export class AdminShiprocketCostController {
  constructor(
    private readonly panelService: ShiprocketCostPanelService,
    private readonly queue: ShiprocketCostSyncQueue,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions('courier.accounts.view')
  @ApiOperation({
    summary:
      'Shiprocket cost sync: switches, wallet balance, recent runs and each parcel’s reading',
  })
  panel(): Promise<ShiprocketCostPanel> {
    return this.panelService.panel();
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.accounts.manage')
  @ApiOperation({
    summary:
      'Queue a Shiprocket cost sync now. Returns when QUEUED, not finished; the run appears in the history when it lands.',
  })
  async run(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ queued: boolean; jobId: string | null }> {
    // Before the enqueue: "who asked" is the question worth answering
    // when a run fails elsewhere.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      action: 'courier.shiprocket_cost.sync_requested',
      entityType: 'courier',
      entityId: null,
      severity: 'MEDIUM',
      metadata: { courierCode: 'shiprocket' },
    });
    return this.queue.requestRun();
  }
}
