import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { PickQueueService } from './services/pick-queue.service';

/**
 * Module 8 — Warehouse Operations (pick). Grows commit-by-commit
 * (pull → allocate → execute → expire).
 *
 * Imports the Order facade (OrderModule — exports only OrderReadService
 * + OrderWriteService) for pull enrichment and the commit-6 pick saga.
 * It is a LEAF consumer: nothing imports `warehouse-pick`, and the
 * order ↔ warehouse-pick cycle is already broken by the R3
 * `shipment-provision` primitive (commit 3) — `warehouse-pick` carries
 * no cross-module export surface.
 *
 * PrismaService + AuditLogService are global.
 */
@Module({
  imports: [OrderModule],
  providers: [PickQueueService],
})
export class WarehousePickModule {}
