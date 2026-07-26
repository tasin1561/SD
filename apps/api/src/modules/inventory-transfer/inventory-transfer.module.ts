import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { AdminStockTransferController } from './admin-stock-transfer.controller';
import { StockTransferService } from './services/stock-transfer.service';

/**
 * R6 — inter-warehouse / bin-to-bin stock transfer. Same shape as
 * `inventory-adjustment` / `inventory-receipt`: imports
 * `InventorySharedModule` for `StockMutationService` (INV-1 sole
 * writer) and does its own stock writes through it. Exports the service
 * so warehouse-side flows can reuse it later (e.g. an RTO "send to the
 * designated warehouse" action).
 */
@Module({
  imports: [InventorySharedModule],
  controllers: [AdminStockTransferController],
  providers: [StockTransferService, StaffJwtGuard],
  exports: [StockTransferService],
})
export class InventoryTransferModule {}
