import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  StockUnitReportService,
  type UnitDiscrepancyReport,
} from '../services/stock-unit-report.service';
import {
  StockUnitAdminReportService,
  type DiscrepancyTriage,
} from '../services/stock-unit-admin-report.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Serialized-unit discrepancies, from the warehouse's side of the glass.
 *
 * Read-only, deliberately. Where the unit ledger and the aggregate
 * disagree, the discrepancy is SURFACED and never auto-corrected
 * (UNIT-1) — reconciling the two silently would destroy the only
 * evidence of what happened on the floor. Fixing one means a stock
 * adjustment through the normal path, with its reason code and its
 * audit row, not a button here.
 */
@ApiTags('admin-stock-units')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('inventory.view')
@Controller('admin/stock-units')
export class AdminStockUnitController {
  constructor(
    private readonly reports: StockUnitReportService,
    private readonly admin: StockUnitAdminReportService,
  ) {}

  @Get('triage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Which sellers need looking at, worst first. The seller report cannot answer this — it needs a sellerId you do not yet have.',
  })
  triage(@Query('warehouseId') warehouseId?: string): Promise<DiscrepancyTriage> {
    return this.admin.triage(warehouseId === undefined ? {} : { warehouseId });
  }

  @Get('discrepancies/:sellerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "One seller's full report — the SAME computation the seller sees, so the two can never disagree mid-support-call.",
  })
  forSeller(
    @Param('sellerId') sellerId: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<UnitDiscrepancyReport> {
    return this.reports.forSeller(sellerId, warehouseId === undefined ? {} : { warehouseId });
  }

  @Get('trace/:sellerId/:serialBarcode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "One unit's whole scan history — every gate it passed, who scanned it, when.",
  })
  trace(
    @Param('sellerId') sellerId: string,
    @Param('serialBarcode') serialBarcode: string,
  ): ReturnType<StockUnitReportService['trace']> {
    return this.reports.trace(sellerId, serialBarcode);
  }
}
