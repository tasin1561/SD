import { Module } from '@nestjs/common';
import { SellerWalletAccrualModule } from '../seller-wallet-accrual/seller-wallet-accrual.module';
import { OrderModule } from '../order/order.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { ManualPlacementQueueService } from './services/manual-placement-queue.service';
import { ManualPlacementService } from './services/manual-placement.service';
import { ManualPlacementController } from './controllers/manual-placement.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';

/**
 * Module 9 — courier-manual-placement (commit 14, CUR-8).
 *
 * The MANUAL_PLACEMENT_ADMIN workflow for shipments Delhivery could not
 * carry: record a manually-arranged courier AWB (→ dispatch the order,
 * Model-A qtyOnHand decrement) or cancel an unfulfillable order.
 *
 * Imports OrderModule (OrderWriteService — the PENDING_MANUAL_PLACEMENT
 * → DISPATCHED / → CANCELLED_BY_ADMIN transitions) and
 * InventoryStockModule (StockReservationService — the conservation
 * guard: every ACTIVE reservation must be phase-2 before dispatch).
 *
 * LEAF consumer — nothing imports `courier-manual-placement`.
 */
@Module({
  imports: [
    OrderModule,
    InventoryStockModule,
    InventorySharedModule,
    // A manually-placed parcel is entered with a courier just as much as
    // a Delhivery one, so it fires the same AT_AWB charge hook.
    SellerWalletAccrualModule,
  ],
  controllers: [ManualPlacementController],
  providers: [ManualPlacementService, ManualPlacementQueueService, StaffJwtGuard],
  exports: [ManualPlacementService],
})
export class CourierManualPlacementModule {}
