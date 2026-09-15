import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { ReportWindowQueryDto } from '../dto/reseller-reports.dto';
import { reportWindow } from '../services/report-window';
import {
  StoreAnalysisService,
  type StoreAnalysis,
  type StoreCashFlow,
  type StorePosition,
} from '../services/store-analysis.service';
import {
  StorePnlPeriodService,
  type StorePnlMonthSummary,
  type StorePnlMonthView,
} from '../services/store-pnl-period.service';
import type { StorePnlReport } from '../services/store-pnl-lines';
import { StorePnlService } from '../services/store-pnl.service';

/**
 * A reseller store's OWN reports (RS-8 / RS-9). Always the caller's
 * store: the id comes from the token, never the request, so there is no
 * store id in any path here by construction.
 */
@ApiTags('store-reports')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('reports.view')
@Controller('store/reports')
export class StoreReportsController {
  constructor(
    private readonly pnl: StorePnlService,
    private readonly periods: StorePnlPeriodService,
    private readonly analysis: StoreAnalysisService,
  ) {}

  @Get('pnl')
  @ApiOperation({ summary: 'The store’s P&L over any window [from, to), with every row behind it' })
  report(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() q: ReportWindowQueryDto,
  ): Promise<StorePnlReport> {
    const w = reportWindow(q.from, q.to);
    return this.pnl.report(user.storeId, w.from, w.to);
  }

  @Get('pnl/months')
  @ApiOperation({ summary: 'Every month since the store opened — frozen once closed' })
  months(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StorePnlMonthSummary[]> {
    return this.periods.listMonths(user.storeId);
  }

  @Get('pnl/months/:month')
  @ApiOperation({ summary: 'One month, with what was carried into and out of it' })
  month(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('month') month: string,
  ): Promise<StorePnlMonthView> {
    return this.periods.monthView(user.storeId, month);
  }

  @Get('position')
  @ApiOperation({ summary: 'What the store is owed, or owes, and what is waiting' })
  position(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StorePosition> {
    return this.analysis.position(user.storeId);
  }

  @Get('analysis')
  @ApiOperation({ summary: 'Profit per product, returns by pincode, rates and return on ad spend' })
  storeAnalysis(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() q: ReportWindowQueryDto,
  ): Promise<StoreAnalysis> {
    return this.analysis.analysis(user.storeId, reportWindow(q.from, q.to));
  }

  @Get('cash-flow')
  @ApiOperation({ summary: 'Credits the store expects, and when' })
  cashFlow(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreCashFlow> {
    return this.analysis.cashFlow(user.storeId);
  }
}
