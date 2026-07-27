import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { StockUnitReportService } from './services/stock-unit-report.service';
import { SellerStockUnitController } from './controllers/seller-stock-unit.controller';
import { AdminStockUnitController } from './controllers/admin-stock-unit.controller';
import { StockUnitAdminReportService } from './services/stock-unit-admin-report.service';

/**
 * R4 — the READ side of serialized inventory. Deliberately separate from
 * `inventory-shared` (which owns the writer): this module has a
 * controller and no write path, so the admin surface could grow here
 * without widening the sole-writer's blast radius — which is what
 * happened: `AdminStockUnitController` is read-only too, because a
 * discrepancy is SURFACED and never auto-corrected (UNIT-1).
 *
 * Exports nothing — it is a leaf consumer.
 */
@Module({
  imports: [SettingsModule, AuthCommonModule],
  controllers: [SellerStockUnitController, AdminStockUnitController],
  providers: [StockUnitReportService, StockUnitAdminReportService, SellerJwtGuard, StaffJwtGuard],
})
export class InventoryUnitModule {}
