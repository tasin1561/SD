import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { StockUnitReportService } from './services/stock-unit-report.service';
import { SellerStockUnitController } from './controllers/seller-stock-unit.controller';

/**
 * R4 — the READ side of serialized inventory. Deliberately separate from
 * `inventory-shared` (which owns the writer): this module has a
 * controller and no write path, so a future admin surface can grow here
 * without widening the sole-writer's blast radius.
 *
 * Exports nothing — it is a leaf consumer.
 */
@Module({
  imports: [SettingsModule, AuthCommonModule],
  controllers: [SellerStockUnitController],
  providers: [StockUnitReportService, SellerJwtGuard],
})
export class InventoryUnitModule {}
