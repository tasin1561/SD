import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { AdminResellerCatalogueController } from './controllers/admin-reseller-catalogue.controller';
import { SellerResellerPriceListController } from './controllers/seller-reseller-price-list.controller';
import { SellerResellerStoreCatalogueController } from './controllers/seller-reseller-store-catalogue.controller';
import { StoreCatalogueController } from './controllers/store-catalogue.controller';
import { ResellerSetAsideWorker } from './queue/reseller-set-aside.worker';
import { ResellerCatalogueService } from './services/reseller-catalogue.service';
import { ResellerSetAsideNotifier } from './services/reseller-set-aside-notifier.service';
import { ResellerSetAsideSweepService } from './services/reseller-set-aside-sweep.service';

/**
 * RS-3 — reseller stores, phase 2: the catalogue, prices and stock.
 *
 * A LEAF: nothing imports it and it exports nothing. Variants are read
 * only through `CatalogReadService` (MUST #13) and stock only through
 * `StockReadService` from inventory-stock's sanctioned surface (MUST
 * #15); it writes nothing but its own four tables. Kept apart from
 * `reseller-store` (the store's life) so neither module grows the
 * other's dependencies.
 */
@Module({
  imports: [AuthCommonModule, CatalogReadModule, InventoryStockModule, NotificationAudienceModule],
  controllers: [
    SellerResellerPriceListController,
    SellerResellerStoreCatalogueController,
    StoreCatalogueController,
    AdminResellerCatalogueController,
  ],
  providers: [
    ResellerCatalogueService,
    ResellerSetAsideSweepService,
    ResellerSetAsideNotifier,
    ResellerSetAsideWorker,
    SellerJwtGuard,
    StaffJwtGuard,
    StoreJwtGuard,
  ],
})
export class ResellerCatalogueModule {}
