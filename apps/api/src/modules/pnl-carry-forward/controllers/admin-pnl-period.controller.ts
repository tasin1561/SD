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
import {
  BackfillPnlCloseDto,
  ClosePnlMonthDto,
  GodModeRelockDto,
  LockPermanentlyDto,
} from '../dto/pnl-period.dto';
import { PnlNightlyGateService } from '../services/pnl-nightly-gate.service';
import { PnlPeriodReadService } from '../services/pnl-period-read.service';
import { PnlPeriodService } from '../services/pnl-period.service';
import { monthWindow } from '../services/pnl-month';

/** An optional `?version=`: absent or blank means the current one. */
function versionParam(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException({
      code: 'INVALID_VERSION',
      message: `"${v}" is not a version number`,
    });
  }
  return n;
}

/**
 * The carry-forward P&L (PNL-CF-1).
 *
 * Reading is the same question /pnl answers and carries the same gate.
 * Closing and locking a month permanently are `money.pnl.close`; restating
 * a permanently locked month is god mode, `money.pnl.god_mode`, a separate
 * permission so that closing months never implies rewriting them. Nothing
 * reopens a month: every lock is a new version and every earlier one is kept.
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
      'One month: a closed month shows its current version (or ?version=N, read only) and the changes found later; an open one its live figures and what earlier months carried into it.',
  })
  @ApiQuery({ name: 'version', required: false, description: 'A locked version to open' })
  monthView(
    @Param('month') month: string,
    @Query('version') version?: string,
  ): ReturnType<PnlPeriodReadService['view']> {
    return this.read.view(month, versionParam(version));
  }

  @Get('pnl-periods/:month/lines/:line/rows')
  @ApiOperation({ summary: 'The records frozen behind one line of a closed month’s version.' })
  @ApiQuery({ name: 'version', required: false, description: 'A locked version to open' })
  frozenRows(
    @Param('month') month: string,
    @Param('line') line: string,
    @Query('version') version?: string,
  ): ReturnType<PnlPeriodReadService['frozenRows']> {
    return this.read.frozenRows(month, line, versionParam(version));
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
      'Whether every nightly job has succeeded since the month ended — what decides FINAL or PROVISIONAL at the scheduled close.',
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
    summary: 'Close a finished month by hand, FINAL. Never reopened.',
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

  @Post('pnl-periods/:month/lock-permanently')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.pnl.close')
  @ApiOperation({
    summary:
      'Lock a PROVISIONAL month permanently: re-snapshot it with everything that has arrived and make it FINAL. The earlier version is kept.',
  })
  lockPermanently(
    @Param('month') month: string,
    @Body() body: LockPermanentlyDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<PnlPeriodService['lockPermanently']> {
    return this.periods.lockPermanently({ month, staffId: staff.id, reason: body.reason });
  }

  @Post('pnl-periods/:month/god-mode-relock')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.pnl.god_mode')
  @ApiOperation({
    summary:
      'GOD MODE: re-lock a month as the ledgers say today, less everything already carried into later months. Every earlier version is kept. Audited CRITICAL.',
  })
  godModeRelock(
    @Param('month') month: string,
    @Body() body: GodModeRelockDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<PnlPeriodService['godModeRelock']> {
    return this.periods.godModeRelock({
      month,
      staffId: staff.id,
      reason: body.reason,
      confirmMonth: body.confirmMonth,
      acknowledgeRisk: body.acknowledgeRisk,
    });
  }

  @Post('pnl-periods/backfill-close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.pnl.close')
  @ApiOperation({
    summary:
      'Close every month with P&L activity through `throughMonth` (default last month), oldest first, FINAL. DRY RUN unless dryRun is false.',
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
