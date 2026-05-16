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
  // Intra-Module-5 sharing: receipt/adjustment/cycle-count call these in
  // their post-commit hooks. The Module 6/8 cross-module surface
  // (StockReadService/StockReservationService/StockPickAllocationService)
  // is added at commit 22; StockAlertService stays internal to Module 5.
  exports: [StockAlertService, StockCacheService],
})
export class InventoryStockModule {}
