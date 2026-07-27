import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { ReportsService, type ReportSummary } from './services/reports.service';

@ApiTags('admin-reports')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Operational summary for a date range (UTC, from inclusive, to exclusive)',
  })
  summary(
    @CurrentStaff() _staff: AuthenticatedStaff,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ReportSummary> {
    const now = new Date();
    const defaultTo = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);
    const parsedFrom = from ? new Date(from) : defaultFrom;
    const parsedTo = to ? new Date(to) : defaultTo;
    return this.svc.summary({
      from: parsedFrom,
      to: parsedTo,
    });
  }
}
