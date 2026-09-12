import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { BackfillAwbLabelsDto } from '../dto/awb-label-backfill.dto';
import {
  AwbLabelRecoveryService,
  type LabelBackfillReport,
} from '../services/awb-label-recovery.service';

/**
 * CUR-6 — fetch and store the shipping label for waybills that have none.
 *
 * Operator-triggered and runbook-driven, not a screen: the hourly
 * watchdog retries pre-dispatch parcels on its own, and this is for the
 * one-off catch-up. `courier.accounts.manage` because every real run
 * spends that courier account's label-API budget.
 */
@ApiTags('admin-awb-labels')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.accounts.manage')
@Controller('admin/courier/awb-labels')
export class AdminAwbLabelController {
  constructor(private readonly recovery: AwbLabelRecoveryService) {}

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fetch and store labels for waybills that have none',
    description:
      'Dry run by default. Never books a waybill: a shipment without one is skipped. Skips manual couriers, retired shipments, shipments that already have a current label, and (in production) couriers answering from a stub. Audited as awb.label_backfill_run.',
  })
  async backfill(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: BackfillAwbLabelsDto,
  ): Promise<LabelBackfillReport> {
    return this.recovery.backfill({
      scope: dto.scope ?? 'PRE_DISPATCH',
      limit: dto.limit ?? 25,
      dryRun: dto.dryRun ?? true,
      staffId: staff.id,
    });
  }
}
