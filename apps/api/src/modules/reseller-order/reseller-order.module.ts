import { Module } from '@nestjs/common';
import { StoreApiKeyGuard } from '../../common/guards/store-api-key.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { OrderCoreModule } from '../order/order-core.module';
import { OrderModule } from '../order/order.module';
import { StoreApiKeyController } from './controllers/store-api-key.controller';
import { StoreApiOrderController } from './controllers/store-api-order.controller';
import { StoreCustomerController } from './controllers/store-customer.controller';
import { StoreOrderController } from './controllers/store-order.controller';
import { StoreOrderEditController } from './controllers/store-order-edit.controller';
import { StoreWebhookController } from './controllers/store-webhook.controller';
import { StoreOrderEditService } from './services/store-order-edit.service';
import { ResellerStoreModule } from '../reseller-store/reseller-store.module';
import { ResellerOrderReadService } from './services/reseller-order-read.service';
import { StoreApiKeyService } from './services/store-api-key.service';
import { StoreOrdersService } from './services/store-orders.service';
import { StoreWebhookService } from './services/store-webhook.service';

/**
 * RS-5 — reseller store ORDERS: the store's portal (orders, customers,
 * API keys, webhooks) and its API-key surface.
 *
 * An INTRA-order-domain submodule, like `order-csv-import`: it imports
 * `OrderCoreModule` for `ResellerOrderService` (the create path) and
 * `CustomerService`, and the public `OrderModule` for
 * `OrderWriteService.cancelBySeller` / `OrderReadService`. Nothing
 * order-shaped imports it back.
 *
 * It EXPORTS exactly one service — `ResellerOrderReadService.snapshotFor`,
 * the seam phase 3c's money listeners read — and posts no wallet entry.
 */
@Module({
  imports: [
    AuthCommonModule,
    CatalogReadModule,
    OrderCoreModule,
    OrderModule,
    // 2026-09-16 — whether a store may correct its own consignee is the
    // SELLER's policy for that store. The policy service cannot live in
    // order-core: `reseller-store` imports `OrderModule`, which imports
    // `OrderCoreModule`, so reaching for it from there would close a
    // cycle. Here it is one-way and safe.
    ResellerStoreModule,
  ],
  controllers: [
    StoreOrderController,
    StoreOrderEditController,
    StoreCustomerController,
    StoreApiKeyController,
    StoreWebhookController,
    StoreApiOrderController,
  ],
  providers: [
    StoreOrdersService,
    StoreOrderEditService,
    ResellerOrderReadService,
    StoreApiKeyService,
    StoreWebhookService,
    StoreJwtGuard,
    StoreApiKeyGuard,
  ],
  exports: [ResellerOrderReadService],
})
export class ResellerOrderModule {}
