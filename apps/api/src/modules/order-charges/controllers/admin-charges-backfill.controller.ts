import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min, IsOptional } from 'class-validator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { OrderChargesService } from '../services/order-charges.service';

export class BackfillChargesDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

/**
 * Give charges to orders that never got any.
 *
 * ── WHY AN ENDPOINT RATHER THAN A MIGRATION ──────────────────────────
 * A migration runs itself, once, with nobody watching the result. This
 * is a money-shaped correction over live orders, so it is triggered by
 * a person who can read what it did — and `dryRun` lets them read it
 * before it happens.
 *
 * It writes charge ROWS only. Taking the money is a different operation
 * that happens at delivery, so this cannot surprise a seller with a
 * debit; what it does is make sure that when delivery comes, there is
 * something to bill.
 */
@ApiTags('admin-order-charges')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.charges.compute')
@Controller('admin/orders/charges')
export class AdminChargesBackfillController {
  constructor(private readonly svc: OrderChargesService) {}

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compute charges for every order that has none (dry-run by default)' })
  backfill(@Body() body: BackfillChargesDto): Promise<{
    examined: number;
    persisted: number;
    skipped: number;
    failed: number;
    orders: Array<{ orderNumber: string; status: string; outcome: string }>;
  }> {
    // DRY RUN BY DEFAULT. An operator who posts an empty body gets a
    // report, not a write — the safe reading of an ambiguous request.
    return this.svc.backfillMissing({
      dryRun: body.dryRun ?? true,
      limit: body.limit ?? 100,
    });
  }
}
