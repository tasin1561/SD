import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { WarehouseManifestModule } from '../warehouse-manifest/warehouse-manifest.module';
import { PackQueueService } from './services/pack-queue.service';
import { PackService } from './services/pack.service';
import { PackBoxService } from './services/pack-box.service';
import { PackBoxExpiryQueue } from './queue/pack-box-expiry.queue';
import { PackBoxExpiryWorker } from './queue/pack-box-expiry.worker';
import { PackerController } from './controllers/packer.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { CourierOpsModule } from '../courier-ops/courier-ops.module';

/**
 * Module 8 — warehouse-pack module. Commit 9 = service layer
 * (PackQueueService.pullNext + PackService.complete + WMS-7 auto-attach
 * to DRAFT manifest via WarehouseManifestModule); commit 10 = packer
 * endpoints.
 *
 * Imports OrderModule for read enrichment + the PICKED→PACKED saga
 * transition, WarehouseManifestModule for the post-pack auto-attach to
 * DRAFT (WMS-7), and CourierOpsModule for `CourierPickupService.raiseIfDue`
 * — a packed parcel asking for today's van when an operator has switched
 * that on for the courier (CUR-10's per-category auto-pickup switch).
 * LEAF consumer — nothing imports `warehouse-pack`.
 *
 * Pack is intentionally claim-free (commit 1 schema added no
 * packStartedAt/packExpiresAt): pull is informational, complete is the
 * race-resolution point via atomic guard on
 * (status=CREATED, pack_completed_at IS NULL). The race is rare at
 * Phase-1A pack volume and surfaces as 409 PACK_NOT_AVAILABLE — the
 * loser pulls again. Revisit if pack volume scales.
 */
@Module({
  imports: [OrderModule, WarehouseManifestModule, InventorySharedModule, CourierOpsModule],
  controllers: [PackerController],
  providers: [
    PackQueueService,
    PackService,
    PackBoxService,
    PackBoxExpiryQueue,
    PackBoxExpiryWorker,
    StaffJwtGuard,
  ],
})
export class WarehousePackModule {}
