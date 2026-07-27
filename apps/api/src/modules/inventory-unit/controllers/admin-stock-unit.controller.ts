import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@skydrop/db';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  StockUnitReportService,
  type UnitDiscrepancyReport,
} from '../services/stock-unit-report.service';
import {
  StockUnitAdminReportService,
  type DiscrepancyTriage,
} from '../services/stock-unit-admin-report.service';

const ROLES = [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.WAREHOUSE_STAFF, StaffRole.SUPER_ADMIN];

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
  triage(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<DiscrepancyTriage> {
    requireStaffRoles(staff, ROLES);
    return this.admin.triage(warehouseId === undefined ? {} : { warehouseId });
  }

  @Get('discrepancies/:sellerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "One seller's full report — the SAME computation the seller sees, so the two can never disagree mid-support-call.",
  })
  forSeller(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('sellerId') sellerId: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<UnitDiscrepancyReport> {
    requireStaffRoles(staff, ROLES);
    return this.reports.forSeller(sellerId, warehouseId === undefined ? {} : { warehouseId });
  }

  @Get('trace/:sellerId/:serialBarcode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "One unit's whole scan history — every gate it passed, who scanned it, when.",
  })
  trace(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('sellerId') sellerId: string,
    @Param('serialBarcode') serialBarcode: string,
  ): ReturnType<StockUnitReportService['trace']> {
    requireStaffRoles(staff, ROLES);
    return this.reports.trace(sellerId, serialBarcode);
  }
}
