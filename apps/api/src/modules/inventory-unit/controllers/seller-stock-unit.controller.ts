import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  StockUnitReportService,
  type UnitDiscrepancyReport,
} from '../services/stock-unit-report.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

/**
 * R4 — the seller's view of their own serialized stock. Read-only by
 * construction: sellers see where their units are and which ones the
 * warehouse can't account for; they never move one.
 */
@ApiTags('seller-stock-units')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('inventory.view')
@Controller('seller/stock-units')
export class SellerStockUnitController {
  constructor(private readonly reports: StockUnitReportService) {}

  @Get('discrepancies')
  @ApiOperation({
    summary:
      'Serialized-unit discrepancy report: units stuck mid-lifecycle past the SLA, long-dispatched-unresolved units, retired (lost/written-off) units, and unit-vs-aggregate count mismatches.',
  })
  report(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<UnitDiscrepancyReport> {
    return this.reports.forSeller(seller.id, warehouseId === undefined ? {} : { warehouseId });
  }

  @Get('trace/:serialBarcode')
  @ApiOperation({
    summary: "One unit's full scan history — every gate it passed, who scanned it and when.",
  })
  trace(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('serialBarcode') serialBarcode: string,
  ): ReturnType<StockUnitReportService['trace']> {
    return this.reports.trace(seller.id, serialBarcode);
  }
}
