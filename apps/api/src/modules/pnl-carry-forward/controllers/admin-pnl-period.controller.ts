import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PnlCloseKind } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { BackfillPnlCloseDto, ClosePnlMonthDto } from '../dto/pnl-period.dto';
import { PnlNightlyGateService } from '../services/pnl-nightly-gate.service';
import { PnlPeriodReadService } from '../services/pnl-period-read.service';
import { PnlPeriodService } from '../services/pnl-period.service';
import { monthWindow } from '../services/pnl-month';

/**
 * The carry-forward P&L (PNL-CF-1).
 *
 * Reading is the same question /pnl answers and carries the same gate.
 * Closing a month is irreversible — there is no reopen endpoint, by the
 * owner's decision — so it has its own permission, SUPER_ADMIN until a
 * role is given it.
 */
@ApiTags('admin-treasury')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.treasury.view')
@Controller('admin/treasury')
export class AdminPnlPeriodController {
  constructor(
    private readonly read: PnlPeriodReadService,
    private readonly periods: PnlPeriodService,
    private readonly gate: PnlNightlyGateService,
  ) {}

  @Get('pnl-periods')
  @ApiOperation({ summary: 'Every P&L month from the first closed one to now, with its status.' })
  listMonths(): ReturnType<PnlPeriodReadService['list']> {
    return this.read.list();
  }

  @Get('pnl-periods/:month')
  @ApiOperation({
    summary:
      'One month: frozen when closed (with the changes found later), live when open (with what earlier months carried into it).',
  })
  monthView(@Param('month') month: string): ReturnType<PnlPeriodReadService['view']> {
    return this.read.view(month);
  }

  @Get('pnl-periods/:month/lines/:line/rows')
  @ApiOperation({ summary: 'The records frozen behind one line of a closed month.' })
  frozenRows(
    @Param('month') month: string,
    @Param('line') line: string,
  ): ReturnType<PnlPeriodReadService['frozenRows']> {
    return this.read.frozenRows(month, line);
  }

  @Get('pnl-carry-forwards')
  @ApiOperation({ summary: 'Carry-forward rows, each with its before, after and reason.' })
  @ApiQuery({ name: 'landedIn', required: false, description: 'YYYY-MM the change counted in' })
  @ApiQuery({ name: 'origin', required: false, description: 'YYYY-MM the change was to' })
  @ApiQuery({ name: 'line', required: false, description: 'A P&L line key' })
  carryForwardRows(
    @Query('landedIn') landedIn?: string,
    @Query('origin') origin?: string,
    @Query('line') line?: string,
  ): ReturnType<PnlPeriodReadService['carryForwards']> {
    const blank = (v: string | undefined): string | undefined =>
      v === undefined || v === '' ? undefined : v;
    return this.read.carryForwards({
      landedIn: blank(landedIn),
      origin: blank(origin),
      line: blank(line),
    });
  }

  @Get('pnl-periods/:month/nightly-jobs')
  @ApiOperation({
    summary:
      'Whether every nightly job has succeeded since the month ended — what the scheduled close waits for.',
  })
  nightlyJobs(@Param('month') month: string): ReturnType<PnlNightlyGateService['check']> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException({
        code: 'INVALID_MONTH',
        message: `"${month}" is not a month (YYYY-MM)`,
      });
    }
    return this.gate.check(monthWindow(month).to);
  }

  @Post('pnl-periods/:month/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.pnl.close')
  @ApiOperation({
    summary:
      'Close a finished month by hand — for when a nightly job failed and was dealt with. Never reopened.',
  })
  closeMonth(
    @Param('month') month: string,
    @Body() body: ClosePnlMonthDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<PnlPeriodService['close']> {
    const reason = body.reason.trim();
    if (reason.length < 10) {
      throw new BadRequestException({
        code: 'PNL_REASON_TOO_SHORT',
        message: 'Say why this month is being closed by hand (at least 10 characters).',
      });
    }
    return this.periods.close({
      month,
      kind: PnlCloseKind.MANUAL,
      staffId: staff.id,
      reason,
      nightlyJobs: null,
    });
  }

  @Post('pnl-periods/backfill-close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.pnl.close')
  @ApiOperation({
    summary:
      'Close every month with P&L activity through `throughMonth` (default last month), oldest first. DRY RUN unless dryRun is false.',
  })
  backfill(
    @Body() body: BackfillPnlCloseDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<PnlPeriodService['backfill']> {
    return this.periods.backfill({
      dryRun: body.dryRun !== false,
      throughMonth: body.throughMonth ?? null,
      reason: body.reason ?? null,
      staffId: staff.id,
    });
  }
}
