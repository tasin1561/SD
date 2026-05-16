import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { SellerStockController } from './seller-stock.controller';
import { StockCacheService } from './services/stock-cache.service';
import { StockReadService } from './services/stock-read.service';
import { SellerStockService } from './services/seller-stock.service';

/**
 * Stock queries, reservations, alerts and the cross-module read boundary.
 * Built up across commits 5–15; cross-module exports (StockReadService,
 * StockReservationService, StockPickAllocationService) are wired at
 * commit 22.
 */
@Module({
  imports: [InventorySharedModule, CatalogReadModule],
  controllers: [SellerStockController],
  providers: [
    StockCacheService,
    StockReadService,
    SellerStockService,
    SellerJwtGuard,
  ],
})
export class InventoryStockModule {}
