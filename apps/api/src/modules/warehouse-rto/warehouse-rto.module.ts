import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { RtoReceiptService } from './services/rto-receipt.service';
import { RtoInspectionService } from './services/rto-inspection.service';

/**
 * Module 8 — warehouse-rto module. Grows commit-by-commit:
 *   - commit 14 (this): receive (by AWB → RTO_RECEIVED) + per-item
 *                       inspect (rtoCondition + rtoDisposition)
 *   - commit 15      : + finalize (atomic RETURN_RESTOCK movements +
 *                       transition to RTO_RESTOCKED, WMS-8 saga) +
 *                       warehouse + admin endpoints
 *
 * Imports OrderModule for the read + the saga transition. LEAF consumer
 * — nothing imports `warehouse-rto`. Commit 15 will additionally import
 * InventoryStockModule (for the M5 cross-module surface — restock
 * movements).
 */
@Module({
  imports: [OrderModule],
  providers: [RtoReceiptService, RtoInspectionService],
})
export class WarehouseRtoModule {}
