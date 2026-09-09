import { Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletSyncService, type WalletSyncSummary } from '../services/wallet-sync.service';
import {
  WalletSyncHistoryService,
  type WalletSyncPanel,
} from '../services/wallet-sync-history.service';

/**
 * The nightly courier-cost sync, and whether it is actually working.
 *
 * Reading is `courier.accounts.view` — it is a report about a courier
 * account's money. RUNNING it is `courier.accounts.manage`, and that is
 * not tidiness: a run drives a real browser session against Delhivery's
 * portal with our credential, and hammering a courier's login is how an
 * account gets locked out. One person able to read the page is fine;
 * one person able to press the button repeatedly is not.
 */
@ApiTags('admin-wallet-sync')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/courier-portal/wallet-sync')
export class AdminWalletSyncController {
  constructor(
    private readonly history: WalletSyncHistoryService,
    private readonly sync: WalletSyncService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions('courier.accounts.view')
  @ApiOperation({
    summary: 'Did the cost sync run, what did it do, and what has it done before',
    description:
      'Current switches, the last run in full, recent history, and how much of what we shipped has a real courier cost against it.',
  })
  panel(@Query('limit') limit?: string): Promise<WalletSyncPanel> {
    const n = Number(limit);
    return this.history.panel(Number.isFinite(n) && n > 0 && n <= 100 ? Math.floor(n) : 20);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.accounts.manage')
  @ApiOperation({
    summary: 'Run the cost sync now',
    description:
      'The same job the scheduler runs, on demand. It signs in to the courier portal, downloads the wallet export and imports it — so it is slow, and it is a real session against their site. Safe to repeat: an import that sees the same figures records them as unchanged.',
  })
  async run(@CurrentStaff() staff: AuthenticatedStaff): Promise<WalletSyncSummary> {
    // Audited BEFORE the run, not after. The run takes a minute or two
    // of browser work and can fail halfway; "who asked for this" is
    // exactly the question worth having on record when it does, and an
    // audit written only on success would not answer it.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      action: 'courier.wallet_ledger.sync_requested',
      entityType: 'courier',
      // A uuid column — the code goes in metadata.
      entityId: null,
      severity: 'MEDIUM',
      metadata: { courierCode: 'delhivery' },
    });
    return this.sync.sync();
  }
}
