import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { EmailModule } from '../email/email.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { AdminStockAdjustmentController } from './admin-stock-adjustment.controller';
import { StockAdjustmentService } from './services/stock-adjustment.service';
import { AdjustmentQueue } from './queue/adjustment.queue';
import { AdjustmentWorker } from './queue/adjustment.worker';

/**
 * Manual stock adjustments (threshold-gated approval workflow). Initiate
 * + auto-execute here; approve/reject + the executor worker extend this
 * module in commit 20.
 */
@Module({
  imports: [InventorySharedModule, CatalogReadModule, EmailModule, InventoryStockModule],
  controllers: [AdminStockAdjustmentController],
  providers: [StockAdjustmentService, AdjustmentQueue, AdjustmentWorker, StaffJwtGuard],
  exports: [StockAdjustmentService],
})
export class InventoryAdjustmentModule {}
