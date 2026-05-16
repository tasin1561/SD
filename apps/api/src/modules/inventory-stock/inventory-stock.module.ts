import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { EmailModule } from '../email/email.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { SellerStockController } from './seller-stock.controller';
import { SellerThresholdController } from './seller-threshold.controller';
import { StockCacheService } from './services/stock-cache.service';
import { StockReadService } from './services/stock-read.service';
import { SellerStockService } from './services/seller-stock.service';
import { StockAlertService } from './services/stock-alert.service';
import { SellerThresholdService } from './services/seller-threshold.service';
import { StockReservationService } from './services/stock-reservation.service';
import { StockPickAllocationService } from './services/stock-pick-allocation.service';
import { ReservationCleanupService } from './services/reservation-cleanup.service';
import { ReservationQueue } from './queue/reservation.queue';
import { ReservationWorker } from './queue/reservation.worker';

/**
 * Stock queries, reservations, alerts and the cross-module read boundary.
 * Built up across commits 5–15; cross-module exports (StockReadService,
 * StockReservationService, StockPickAllocationService) are wired at
 * commit 22.
 */
@Module({
  imports: [InventorySharedModule, CatalogReadModule, EmailModule],
  controllers: [SellerStockController, SellerThresholdController],
  providers: [
    StockCacheService,
    StockReadService,
    SellerStockService,
    StockAlertService,
    SellerThresholdService,
    StockReservationService,
    StockPickAllocationService,
    ReservationCleanupService,
    ReservationQueue,
    ReservationWorker,
    SellerJwtGuard,
  ],
  // ── EXPORT BOUNDARY ──────────────────────────────────────────────────
  // SANCTIONED cross-module surface (Module 6 Orders / Module 8 Warehouse
  // Ops) — these three ONLY. See each class's JSDoc for the method-level
  // API contract:
  //   • StockReadService            — getVariantStockLive (mutation paths)
  //   • StockReservationService     — reserve/release/fulfill (Module 6/8)
  //   • StockPickAllocationService  — allocateForOrderLine / -AndPopulate
  //
  // StockAlertService + StockCacheService are also exported, but ONLY so
  // sibling Module-5 modules (inventory-receipt / -adjustment) can run
  // their post-commit hooks (INV-5). They are NOT part of the Module 6/8
  // contract and must not be consumed from Module 6+. StockMutationService
  // is intentionally NOT here (it lives in inventory-shared and is the
  // internal sole writer — INV-1).
  exports: [
    StockReadService,
    StockReservationService,
    StockPickAllocationService,
    StockAlertService,
    StockCacheService,
  ],
})
export class InventoryStockModule {}
