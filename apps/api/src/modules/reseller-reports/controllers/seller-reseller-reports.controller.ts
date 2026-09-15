import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { AutoPauseRuleDto, ReportWindowQueryDto } from '../dto/reseller-reports.dto';
import { reportWindow } from '../services/report-window';
import { ResellerAutoPauseService } from '../services/reseller-auto-pause.service';
import {
  SellerResellerAnalysisService,
  type AutoPauseRuleView,
  type SellerScorecards,
  type StockForecast,
  type TransferRevenueReport,
} from '../services/seller-reseller-analysis.service';

/**
 * The seller's reports on their reseller stores (RS-8 / RS-9): each
 * store's scorecard and balance, stores ranked by profit, transfer
 * revenue by store, and the stock forecast. Never a store's expenses or
 * P&L. Every query carries the seller id from the TOKEN.
 *
 * Reads need `stores.reports`; setting a store's auto-pause rule pauses
 * the store, so it needs `stores.manage` (the lifecycle permission).
 */
@ApiTags('seller-reseller-reports')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.reports')
@Controller('seller/reseller-reports')
export class SellerResellerReportsController {
  constructor(
    private readonly analysis: SellerResellerAnalysisService,
    private readonly autoPause: ResellerAutoPauseService,
  ) {}

  @Get('scorecards')
  @ApiOperation({ summary: 'Each store’s scorecard and balance, and the stores ranked by profit' })
  scorecards(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() q: ReportWindowQueryDto,
  ): Promise<SellerScorecards> {
    return this.analysis.scorecards(seller.id, reportWindow(q.from, q.to));
  }

  @Get('transfer-revenue')
  @ApiOperation({ summary: 'What each store brought in on your wallet, entry by entry' })
  transferRevenue(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() q: ReportWindowQueryDto,
  ): Promise<TransferRevenueReport> {
    return this.analysis.transferRevenue(seller.id, reportWindow(q.from, q.to));
  }

  @Get('stock-forecast')
  @ApiOperation({ summary: 'How long the stock your reseller stores sell will last' })
  stockForecast(@CurrentSeller() seller: AuthenticatedSeller): Promise<StockForecast> {
    return this.analysis.stockForecast(seller.id);
  }

  @Put('stores/:storeId/auto-pause')
  @RequireSellerPermissions('stores.manage')
  @ApiOperation({ summary: 'Pause this store automatically when too many parcels come back' })
  setAutoPause(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: AutoPauseRuleDto,
  ): Promise<AutoPauseRuleView> {
    return this.autoPause.setRule(seller, storeId, body);
  }
}
