import { Module } from '@nestjs/common';
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
import { OrderService } from './services/order.service';
import { OrderAdminOverrideService } from './services/order-admin-override.service';

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
    CatalogReadModule,
    InventoryStockModule,
    CallQueueModule,
    // M15→M6 auto-compute on order create. OrderService injects
    // OrderChargesService and fires a post-commit
    // persistForOrderSystem() — best-effort, never rolls back.
    OrderChargesModule,
    EarlyReservationModule,
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
