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
import { ShiprocketPortalTriggerService } from '../services/shiprocket-portal-trigger.service';

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
    private readonly portal: ShiprocketPortalTriggerService,
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

  @Post('portal-probe')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.accounts.manage')
  @ApiOperation({
    summary:
      'Sign in to Shiprocket’s panel (through the Bangalore tunnel) and save what the Passbook, Ledger and Recharge History pages show. Queued; reads only.',
  })
  async portalProbe(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ queued: boolean; jobId: string | null }> {
    // A real sign-in to a courier's panel: who asked belongs on record.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      action: 'courier.shiprocket_portal.probe_requested',
      entityType: 'courier',
      entityId: null,
      severity: 'MEDIUM',
      metadata: { courierCode: 'shiprocket' },
    });
    return this.portal.requestProbe();
  }

  @Post('wallet-sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.accounts.manage')
  @ApiOperation({
    summary:
      'Run the Shiprocket wallet sync now: sign in through the Bangalore tunnel, read the Passbook, Recharge History and Ledger, store each movement once and net each parcel’s cost. Queued.',
  })
  async walletSync(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ queued: boolean; jobId: string | null }> {
    // A real sign-in that can write costs: who asked belongs on record.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      action: 'courier.shiprocket_wallet.sync_requested',
      entityType: 'courier',
      entityId: null,
      severity: 'MEDIUM',
      metadata: { courierCode: 'shiprocket' },
    });
    return this.portal.requestWalletSync();
  }
}
