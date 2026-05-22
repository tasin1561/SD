import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { CourierAwbModule } from '../courier-awb/courier-awb.module';
import { ManifestService } from './services/manifest.service';
import { ManifestNumberingService } from './services/manifest-numbering.service';
import { AdminManifestController } from './controllers/admin-manifest.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';

/**
 * Module 8 — warehouse manifest module (extended Module 9).
 *   - ManifestService.attachShipment / moveShipment / close /
 *     listManifests / getById (WMS-6/7)
 *   - Module 9 (commit 10): close() enqueues the per-manifest AWB
 *     generation BullMQ job (CUR-2) — replaces the M8 audit-only stub.
 *
 * Imports OrderModule (OrderWriteService — close's per-shipment
 * PACKED→PENDING_DISPATCH saga) and CourierAwbModule (AwbGenerationQueue
 * — the close→AWB-job enqueue). The warehouse-manifest → courier-awb
 * dependency is one-way + acyclic (courier-awb imports neither
 * warehouse-manifest nor anything that does).
 */
@Module({
  imports: [OrderModule, CourierAwbModule],
  controllers: [AdminManifestController],
  providers: [ManifestService, ManifestNumberingService, StaffJwtGuard],
  exports: [ManifestService],
})
export class WarehouseManifestModule {}
