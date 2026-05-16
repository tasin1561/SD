import { Module } from '@nestjs/common';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { StockCacheService } from './services/stock-cache.service';

/**
 * Stock queries, reservations, alerts and the cross-module read boundary.
 * Built up across commits 5–15; cross-module exports (StockReadService,
 * StockReservationService, StockPickAllocationService) are wired at
 * commit 22. For now only the internal cache lives here.
 */
@Module({
  imports: [InventorySharedModule],
  providers: [StockCacheService],
})
export class InventoryStockModule {}
