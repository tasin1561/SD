import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { PickQueueService } from './services/pick-queue.service';
import { PickAllocationService } from './services/pick-allocation.service';

/**
 * Module 8 — Warehouse Operations (pick). Grows commit-by-commit
 * (pull → allocate → execute → expire).
 *
 * Imports the Order facade (OrderModule — exports only OrderReadService
 * + OrderWriteService) for pull enrichment and the commit-6 pick saga,
 * and InventoryStockModule for the M5 cross-module surface (only
 * StockPickAllocationService is consumed — WMS-3, commit 5). It is a
 * LEAF consumer: nothing imports `warehouse-pick`, and the
 * order ↔ warehouse-pick cycle is already broken by the R3
 * `shipment-provision` primitive (commit 3) — `warehouse-pick` carries
 * no cross-module export surface.
 *
 * PrismaService + AuditLogService are global.
 */
@Module({
  imports: [OrderModule, InventoryStockModule],
  providers: [PickQueueService, PickAllocationService],
})
export class WarehousePickModule {}
