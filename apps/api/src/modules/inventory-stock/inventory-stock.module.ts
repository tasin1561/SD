import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { SellerStockController } from './seller-stock.controller';
import { SellerThresholdController } from './seller-threshold.controller';
import { StockReadService } from './services/stock-read.service';
import { SellerStockService } from './services/seller-stock.service';
import { SellerThresholdService } from './services/seller-threshold.service';
import { StockReservationService } from './services/stock-reservation.service';
import { StockPickAllocationService } from './services/stock-pick-allocation.service';
import { ReservationCleanupService } from './services/reservation-cleanup.service';
import { ReservationQueue } from './queue/reservation.queue';
import { ReservationWorker } from './queue/reservation.worker';

/**
 * Stock queries, reservations and the cross-module read boundary.
 *
 * The availability primitive, display cache and low-stock alert state
 * machine now live in inventory-shared (resolves deviation #7) — this
 * module consumes StockCacheService / StockAvailabilityService from there
 * via InventorySharedModule. CatalogReadModule is still needed directly
 * (StockReadService resolves variant metadata through it). EmailModule is
 * no longer imported here: StockAlertService (the only email consumer)
 * moved out.
 */
@Module({
  imports: [InventorySharedModule, CatalogReadModule],
  controllers: [SellerStockController, SellerThresholdController],
  providers: [
    StockReadService,
    SellerStockService,
    SellerThresholdService,
    StockReservationService,
    StockPickAllocationService,
    ReservationCleanupService,
    ReservationQueue,
    ReservationWorker,
    SellerJwtGuard,
  ],
  // ── EXPORT BOUNDARY ──────────────────────────────────────────────────
  // The SANCTIONED cross-module surface (Module 6 Orders / Module 8
  // Warehouse Ops) is now EXACTLY these three — the facade is closed.
  // See each class's JSDoc for the method-level API contract:
  //   • StockReadService            — getVariantStockLive (mutation paths)
  //                                   + *ForDisplay/*Summary (cache-backed)
  //   • StockReservationService     — reserve/release/fulfill (Module 6/8)
  //   • StockPickAllocationService  — allocateForOrderLine / -AndPopulate
  //
  // StockMutationService (sole writer, INV-1), StockAvailabilityService
  // (INV-3 scalar), StockCacheService and StockAlertService all live in
  // inventory-shared and are NOT part of the Module 6/8 contract.
  exports: [StockReadService, StockReservationService, StockPickAllocationService],
})
export class InventoryStockModule {}
