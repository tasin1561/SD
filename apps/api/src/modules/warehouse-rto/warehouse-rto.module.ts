import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { RtoReceiptService } from './services/rto-receipt.service';
import { RtoInspectionService } from './services/rto-inspection.service';
import { RtoDispositionService } from './services/rto-disposition.service';
import { WarehouseRtoController } from './controllers/warehouse-rto.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';

/**
 * Module 8 — warehouse-rto module. CP3 surface:
 *   - receive (by AWB → RTO_RECEIVED, commit 14)
 *   - inspect (rtoCondition + rtoDisposition per shipment_item, commit 14)
 *   - finalize (atomic RETURN_RESTOCK movements + RTO_RESTOCKED
 *     transition, WMS-8 two-gate saga, commit 15)
 *   + the warehouse operator HTTP endpoints
 *
 * Imports OrderModule for the read + the saga transitions,
 * InventorySharedModule for StockMutationService (the only sanctioned
 * stock writer, INV-1 — used for the WRITE_OFF ADJUSTMENT_DECREASE
 * movement), and InventoryStockModule for StockReservationService.
 * release() (the bug-fix follow-on replaces the original RETURN_RESTOCK
 * inflate with a reservation release — see RtoDispositionService
 * JSDoc).
 *
 * LEAF consumer — nothing imports `warehouse-rto`.
 */
@Module({
  imports: [OrderModule, InventorySharedModule, InventoryStockModule],
  controllers: [WarehouseRtoController],
  providers: [
    RtoReceiptService,
    RtoInspectionService,
    RtoDispositionService,
    StaffJwtGuard,
  ],
})
export class WarehouseRtoModule {}
