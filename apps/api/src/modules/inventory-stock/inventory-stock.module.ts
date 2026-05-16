import { Module } from '@nestjs/common';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { StockCacheService } from './services/stock-cache.service';
import { StockReadService } from './services/stock-read.service';

/**
 * Stock queries, reservations, alerts and the cross-module read boundary.
 * Built up across commits 5–15; cross-module exports (StockReadService,
 * StockReservationService, StockPickAllocationService) are wired at
 * commit 22.
 */
@Module({
  imports: [InventorySharedModule, CatalogReadModule],
  providers: [StockCacheService, StockReadService],
})
export class InventoryStockModule {}
