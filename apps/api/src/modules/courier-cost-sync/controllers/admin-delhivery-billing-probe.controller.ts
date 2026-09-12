import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletSyncTriggerService } from '../services/wallet-sync-trigger.service';
import {
  ACTION_DELHIVERY_BILLING_PROBE_REQUESTED,
  DelhiveryBillingProbeReaderService,
  type DelhiveryBillingProbeView,
} from '../services/delhivery-billing-probe-reader.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one-off, READ-ONLY look at Delhivery's billing pages.
 *
 * On the API side of the process boundary for the same reason as the cost
 * sync's controller: the portal module is unreachable from AppModule, so a
 * controller there would answer 404. Running it is `courier.accounts.manage`
 * (a real browser session against a courier login); reading what it found
 * is `courier.accounts.view`. No screen — it is called from a terminal
 * while the Delhivery invoice check is being designed.
 */
@ApiTags('admin-delhivery-billing-probe')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/courier-portal/delhivery-billing-probe')
export class AdminDelhiveryBillingProbeController {
  constructor(
    private readonly trigger: WalletSyncTriggerService,
    private readonly reader: DelhiveryBillingProbeReaderService,
    private readonly audit: AuditLogService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.accounts.manage')
  @ApiOperation({
    summary: 'Look at Delhivery’s billing pages now (read-only)',
    description:
      'Queues a one-off probe in the portal worker: signs in with the wallet sync’s session, finds the invoice list, downloads the latest invoice’s files and records what it saw. Navigates, reads and downloads only. Returns when QUEUED; poll GET with the runId.',
  })
  async run(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ queued: boolean; jobId: string | null; runId: string }> {
    const runId = randomUUID();
    // Before the enqueue: "who asked" is worth having when the run fails
    // in the other process — and it is what GET pairs with the result.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      action: ACTION_DELHIVERY_BILLING_PROBE_REQUESTED,
      entityType: 'courier',
      entityId: null,
      severity: 'MEDIUM',
      metadata: { courierCode: 'delhivery', runId },
    });
    const queued = await this.trigger.requestBillingProbe(runId, staff.id);
    return { ...queued, runId };
  }

  @Get()
  @RequirePermissions('courier.accounts.view')
  @ApiOperation({
    summary: 'What the Delhivery billing probe found',
    description:
      'The latest run, or the one named by runId: its status, the findings the worker stored, and short-lived links to the files and screenshots it saved.',
  })
  view(@Query('runId') runId?: string): Promise<DelhiveryBillingProbeView> {
    if (runId !== undefined && !UUID.test(runId)) {
      throw new BadRequestException({ code: 'INVALID_RUN_ID', message: 'runId must be a uuid' });
    }
    return this.reader.view(runId);
  }
}
