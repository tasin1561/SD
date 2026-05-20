import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
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
 * Imports OrderModule for the read + the saga transitions, and
 * InventorySharedModule for StockMutationService — the only sanctioned
 * stock writer (INV-1). Same import shape as inventory-adjustment:
 * direct mutations live below the inventory-stock cross-module surface
 * (which is for reservations / reads / pick allocation), and
 * StockMutationService is the primitive every "I'm writing stock"
 * caller depends on.
 *
 * LEAF consumer — nothing imports `warehouse-rto`.
 */
@Module({
  imports: [OrderModule, InventorySharedModule],
  controllers: [WarehouseRtoController],
  providers: [
    RtoReceiptService,
    RtoInspectionService,
    RtoDispositionService,
    StaffJwtGuard,
  ],
})
export class WarehouseRtoModule {}
