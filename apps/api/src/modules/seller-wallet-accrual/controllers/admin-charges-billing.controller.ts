import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  ChargesBillingBackfillService,
  type BillingBackfillReport,
} from '../services/charges-billing-backfill.service';

export class BillUnbilledDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * Bill orders that finished their journey unbilled.
 *
 * Deliberately separate from the charge-row backfill, and behind a
 * money permission rather than a pricing one: writing a row records
 * what an order cost, and THIS takes it out of a seller's wallet.
 *
 * Dry run by default. An operator who posts an empty body gets a list
 * of what would be charged and to whom — the only safe reading of an
 * ambiguous request against real balances.
 */
@ApiTags('admin-wallets')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.wallets.bill_unbilled')
@Controller('admin/wallets/charges')
export class AdminChargesBillingController {
  constructor(private readonly svc: ChargesBillingBackfillService) {}

  @Post('bill-unbilled')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Charge delivered/returned orders that were never billed' })
  bill(@Body() body: BillUnbilledDto): Promise<BillingBackfillReport> {
    return this.svc.run({ dryRun: body.dryRun ?? true, limit: body.limit ?? 50 });
  }
}
