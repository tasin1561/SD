import { Module } from '@nestjs/common';
import { SellerRestrictionModule } from '../seller-restriction/seller-restriction.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { OrderChargesModule } from '../order-charges/order-charges.module';
import { EarlyReservationModule } from '../early-reservation/early-reservation.module';
import { OrderNumberingService } from './services/order-numbering.service';
import { OrderStateMachineService } from './services/order-state-machine.service';
import { OrderEventWriterService } from './services/order-event-writer.service';
import { CustomerReputationService } from './services/customer-reputation.service';
import { CustomerService } from './services/customer.service';
import { RecipientAddressCacheService } from './services/recipient-address-cache.service';
import { AddressValidationService } from './services/address-validation.service';
import { SellerCreditModule } from '../seller-credit/seller-credit.module';
import { OrderService } from './services/order.service';
import { OrderAdminOverrideService } from './services/order-admin-override.service';
import { SellerStoreModule } from '../seller-store/seller-store.module';
import { SellerWalletAccrualModule } from '../seller-wallet-accrual/seller-wallet-accrual.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';

/**
 * Module 6 — INTERNAL core (the Module-5 `inventory-shared` analogue).
 *
 * Holds the order-domain INTERNAL providers and exports them for
 * INTRA-Module-6 consumption only: the public `OrderModule` (controllers
 * + the Read/Write facade) and the `order-csv-import` submodule import
 * this. It is NOT imported by other domains. The narrow cross-module
 * facade (OrderReadService + OrderWriteService) is provided by
 * `OrderModule` itself — NestJS forbids re-exporting an imported
 * module's providers, so the two public services live in OrderModule and
 * draw their internal deps (state machine, event writer) from here.
 *
 * AuditLogService is global (AuthCommonModule @Global). CatalogReadModule
 * is the sanctioned cross-module variant boundary (CLAUDE MUST #13);
 * InventoryStockModule supplies the three sanctioned stock services
 * (CLAUDE MUST #15) consumed by OrderWriteService / god mode.
 * CallQueueModule is the shared R3 primitive (depends on neither side)
 * so OrderService can enqueue a freshly-PENDING_CONFIRMATION order for
 * call confirmation (CC-6) without a circular module dependency.
 */
@Module({
  imports: [
    // Which shopfront a sale is filed under (R3 primitive — it
    // imports neither order nor auth, so wiring it into both closes
    // no cycle).
    SellerStoreModule,
    CatalogReadModule,
    InventoryStockModule,
    CallQueueModule,
    // M15→M6 auto-compute on order create. OrderService injects
    // OrderChargesService and fires a post-commit
    // persistForOrderSystem() — best-effort, never rolls back.
    OrderChargesModule,
    EarlyReservationModule,
    SellerRestrictionModule,
    // A wallet too deep in the red stops new orders, checked beside the
    // restriction so the CSV path is covered by the same line.
    SellerCreditModule,
    // God mode mirrors transitionStatus's cancel-time refund of the
    // delivery fee (OrderChargesRefundService). No cycle:
    // seller-wallet-accrual imports neither order module — OrderModule
    // already imports it for the same refund.
    SellerWalletAccrualModule,
    // God mode emits the same lifecycle event a matrix transition does
    // (ORD-2, 2026-09-12). The R3 bus is dependency-free, so this is the
    // same edge OrderModule already has.
    LifecycleEventsModule,
  ],
  providers: [
    OrderNumberingService,
    OrderStateMachineService,
    OrderEventWriterService,
    CustomerService,
    CustomerReputationService,
    RecipientAddressCacheService,
    AddressValidationService,
    OrderService,
    OrderAdminOverrideService,
  ],
  exports: [
    CustomerReputationService,
    OrderNumberingService,
    OrderStateMachineService,
    OrderEventWriterService,
    CustomerService,
    RecipientAddressCacheService,
    AddressValidationService,
    OrderService,
    OrderAdminOverrideService,
  ],
})
export class OrderCoreModule {}
