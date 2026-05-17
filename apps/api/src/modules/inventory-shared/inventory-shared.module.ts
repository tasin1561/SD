import { Module } from '@nestjs/common';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { EmailModule } from '../email/email.module';
import { WarehouseResolverService } from './warehouse-resolver.service';
import { StockMutationService } from './stock-mutation.service';
import { StockAvailabilityService } from './stock-availability.service';
import { StockCacheService } from './stock-cache.service';
import { StockAlertService } from './stock-alert.service';

/**
 * Shared inventory primitives consumed by every inventory-* module.
 * No controllers — pure provider/export surface (the catalog-read
 * pattern).
 *
 *  - StockMutationService   — the single sanctioned stock writer (INV-1).
 *  - StockAvailabilityService — the INV-3 qtyAvailable scalar primitive
 *    (clamped, no cache, no side effects). Consumed by StockReadService's
 *    siblings and the alert/reservation paths so availability math lives
 *    in one place without depending on StockReadService.
 *  - StockCacheService      — best-effort display cache (INV-2; reads-only
 *    for seller-facing displays, never a mutation-decision input).
 *  - StockAlertService      — the INV-9 low-stock state machine. Lives
 *    here (not inventory-stock) because it is consumed only by sibling
 *    inventory modules' post-commit hooks (receipt / adjustment); it
 *    reads availability via StockAvailabilityService, NOT StockReadService
 *    — which is what keeps inventory-shared free of an inventory-stock
 *    dependency (resolves Module 5 deviation #7).
 *
 * Imports CatalogReadModule + EmailModule solely for StockAlertService
 * (variant lookup + the low-stock email). Neither imports any inventory
 * module, so there is no cycle.
 */
@Module({
  imports: [CatalogReadModule, EmailModule],
  providers: [
    WarehouseResolverService,
    StockMutationService,
    StockAvailabilityService,
    StockCacheService,
    StockAlertService,
  ],
  exports: [
    WarehouseResolverService,
    StockMutationService,
    StockAvailabilityService,
    StockCacheService,
    StockAlertService,
  ],
})
export class InventorySharedModule {}
