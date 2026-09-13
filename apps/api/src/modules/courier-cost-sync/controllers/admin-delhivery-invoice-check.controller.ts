import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletSyncTriggerService } from '../services/wallet-sync-trigger.service';

export const ACTION_DELHIVERY_INVOICE_CHECK_REQUESTED =
  'courier.delhivery_invoices.check_requested';

/**
 * Run the nightly Delhivery invoice check NOW.
 *
 * On the API side of the process boundary for the same reason as the cost
 * sync's and the billing probe's controllers: the portal module is
 * unreachable from AppModule, so a controller there would answer 404. This
 * only enqueues the job the 04:10 IST schedule adds; the portal worker runs
 * it. `courier.accounts.manage`, because a run is a real browser session
 * against a courier login. What it found is in the audit log
 * (`courier.delhivery_invoices.checked`) and on /system-issues.
 */
@ApiTags('admin-delhivery-invoice-check')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/courier-portal/delhivery-invoice-check')
export class AdminDelhiveryInvoiceCheckController {
  constructor(
    private readonly trigger: WalletSyncTriggerService,
    private readonly audit: AuditLogService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.accounts.manage')
  @ApiOperation({
    summary: 'Check Delhivery’s invoices against the wallet now (read-only)',
    description:
      'Queues the nightly invoice check in the portal worker: signs in with the wallet sync’s session, reads the invoice list, each invoice’s transaction list and the credit/debit notes, and compares them with our stored wallet ledger. Returns when QUEUED.',
  })
  async run(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ queued: boolean; jobId: string | null }> {
    // Before the enqueue: "who asked" is worth having when the run fails
    // in the other process.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      action: ACTION_DELHIVERY_INVOICE_CHECK_REQUESTED,
      entityType: 'courier',
      entityId: null,
      severity: 'MEDIUM',
      metadata: { courierCode: 'delhivery' },
    });
    return this.trigger.requestInvoiceCheck(staff.id);
  }
}
