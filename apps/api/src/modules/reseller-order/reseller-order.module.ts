import { Module } from '@nestjs/common';
import { StoreApiKeyGuard } from '../../common/guards/store-api-key.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { OrderCoreModule } from '../order/order-core.module';
import { OrderModule } from '../order/order.module';
import { StoreApiKeyController } from './controllers/store-api-key.controller';
import { StoreApiOrderController } from './controllers/store-api-order.controller';
import { SellerAddressChangeController } from './controllers/seller-address-change.controller';
import { StoreCustomerController } from './controllers/store-customer.controller';
import { StoreOrderController } from './controllers/store-order.controller';
import { StoreOrderEditController } from './controllers/store-order-edit.controller';
import { StoreWebhookController } from './controllers/store-webhook.controller';
import { AddressChangeNotifier } from './services/address-change-notifier.service';
import { SellerAddressChangeDecisionService } from './services/seller-address-change-decision.service';
import { StoreAddressChangeService } from './services/store-address-change.service';
import { StoreOrderEditService } from './services/store-order-edit.service';
import { ResellerStoreModule } from '../reseller-store/reseller-store.module';
import { StoreOrderRequestModule } from '../store-order-request/store-order-request.module';
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
    // 2026-09-17 — a store's cancel held for seller staff (ASK_SELLER).
    // An R3 primitive: it imports nothing order-shaped.
    StoreOrderRequestModule,
    // A HELD address correction has to tell both sides: the seller
    // in-app that somebody is waiting on them, the store by email when
    // they answer (a reseller store has no inbox). Deliberately NOT by
    // importing `delivery-action`, whose own header states it is a leaf
    // nothing imports — that property is worth more than reusing its
    // notifier, so this module has its own of the same shape.
    NotificationAudienceModule,
    NotificationLedgerModule,
  ],
  controllers: [
    StoreOrderController,
    StoreOrderEditController,
    StoreCustomerController,
    StoreApiKeyController,
    StoreWebhookController,
    StoreApiOrderController,
    // The seller's half of the address-correction queue. A sibling of
    // `/seller/store-action-requests` in `delivery-action`; one page in
    // apps/seller calls both.
    SellerAddressChangeController,
  ],
  providers: [
    StoreOrdersService,
    StoreOrderEditService,
    StoreAddressChangeService,
    SellerAddressChangeDecisionService,
    AddressChangeNotifier,
    ResellerOrderReadService,
    StoreApiKeyService,
    StoreWebhookService,
    StoreJwtGuard,
    StoreApiKeyGuard,
  ],
  exports: [ResellerOrderReadService],
})
export class ResellerOrderModule {}
