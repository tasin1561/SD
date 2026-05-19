import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { PickQueueService } from './services/pick-queue.service';
import { PickAllocationService } from './services/pick-allocation.service';
import { PickExecutionService } from './services/pick-execution.service';
import { PickExpirationService } from './services/pick-expiration.service';
import { PickExpirationQueue } from './queue/pick-expiration.queue';
import { PickExpirationWorker } from './queue/pick-expiration.worker';

/**
 * Module 8 — Warehouse Operations (pick). Checkpoint 1 = the full
 * service+worker layer (pull → allocate → execute → expire); the
 * picker/supervisor HTTP controllers land post-checkpoint-1.
 *
 * Imports the Order facade (OrderModule — exports only OrderReadService
 * + OrderWriteService) for pull enrichment and the pick saga, and
 * InventoryStockModule for the M5 cross-module surface
 * (StockPickAllocationService — WMS-3 allocate + WMS-5 releaseAllocation;
 * StockReservationService — listActiveForOrder). It is a LEAF consumer:
 * nothing imports `warehouse-pick`, and the order ↔ warehouse-pick
 * cycle is already broken by the R3 `shipment-provision` primitive
 * (commit 3) — `warehouse-pick` carries no cross-module export surface.
 *
 * The WMS-5 expiration trio (queue + service + in-process worker)
 * mirrors M7's AssignmentExpiration trio exactly. PrismaService +
 * AuditLogService + RedisService are global.
 */
@Module({
  imports: [OrderModule, InventoryStockModule],
  providers: [
    PickQueueService,
    PickAllocationService,
    PickExecutionService,
    PickExpirationService,
    PickExpirationQueue,
    PickExpirationWorker,
  ],
})
export class WarehousePickModule {}
