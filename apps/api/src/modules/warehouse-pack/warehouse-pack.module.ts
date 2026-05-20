import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { WarehouseManifestModule } from '../warehouse-manifest/warehouse-manifest.module';
import { PackQueueService } from './services/pack-queue.service';
import { PackService } from './services/pack.service';
import { PackerController } from './controllers/packer.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';

/**
 * Module 8 — warehouse-pack module. Commit 9 = service layer
 * (PackQueueService.pullNext + PackService.complete + WMS-7 auto-attach
 * to DRAFT manifest via WarehouseManifestModule); commit 10 = packer
 * endpoints.
 *
 * Imports OrderModule for read enrichment + the PICKED→PACKED saga
 * transition, and WarehouseManifestModule for the post-pack auto-attach
 * to DRAFT (WMS-7). LEAF consumer — nothing imports `warehouse-pack`.
 *
 * Pack is intentionally claim-free (commit 1 schema added no
 * packStartedAt/packExpiresAt): pull is informational, complete is the
 * race-resolution point via atomic guard on
 * (status=CREATED, pack_completed_at IS NULL). The race is rare at
 * Phase-1A pack volume and surfaces as 409 PACK_NOT_AVAILABLE — the
 * loser pulls again. Revisit if pack volume scales.
 */
@Module({
  imports: [OrderModule, WarehouseManifestModule],
  controllers: [PackerController],
  providers: [PackQueueService, PackService, StaffJwtGuard],
})
export class WarehousePackModule {}
