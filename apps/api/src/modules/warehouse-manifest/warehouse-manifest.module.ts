import { Module } from '@nestjs/common';
import { ManifestService } from './services/manifest.service';
import { ManifestNumberingService } from './services/manifest-numbering.service';

/**
 * Module 8 — warehouse manifest module. Grows commit-by-commit:
 *   - commit 9  (this): ManifestService.attachShipment (find-or-create
 *                       DRAFT + attach, WMS-7 — used by PackService
 *                       post-complete)
 *   - commit 11      : + moveShipment (DRAFT↔DRAFT, supervisor)
 *   - commit 12      : + close (DRAFT→CLOSED, WMS-6) + M9 AWB stub
 *   - commit 13      : supervisor + admin manifest endpoints
 *
 * Exports ManifestService so warehouse-pack (and later supervisor
 * controllers) can consume it. PrismaService + AuditLogService are
 * global. No cross-module dependency: ManifestService imports neither
 * order, warehouse-pick, nor warehouse-pack — it is a LEAF primitive
 * those domains call into (one-way fan-in).
 */
@Module({
  providers: [ManifestService, ManifestNumberingService],
  exports: [ManifestService],
})
export class WarehouseManifestModule {}
