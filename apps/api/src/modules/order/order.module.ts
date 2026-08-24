import { Module } from '@nestjs/common';
import { SellerRestrictionModule } from '../seller-restriction/seller-restriction.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { ShipmentProvisionModule } from '../shipment-provision/shipment-provision.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { SellerWalletAccrualModule } from '../seller-wallet-accrual/seller-wallet-accrual.module';
import { OrderCoreModule } from './order-core.module';
import { SellerOrderController } from './controllers/seller-order.controller';
import { SellerCustomerController } from './controllers/seller-customer.controller';
import { SellerRecipientAddressController } from './controllers/seller-recipient-address.controller';
import { AdminOrderController } from './controllers/admin-order.controller';
import { SettingsModule } from '../settings/settings.module';
import { SellerOrderDefaultsController } from './controllers/seller-order-defaults.controller';
import { OrderReadService } from './services/order-read.service';
import { OrderWriteService } from './services/order-write.service';

/**
 * Module 6 — Order Management (PUBLIC facade).
 *
 * ── SANCTIONED CROSS-MODULE SURFACE ────────────────────────────────────
 * This module exports EXACTLY TWO services — the only order-domain
 * entry points other domains (Module 7 call centre, Module 8 warehouse
 * ops, future pricing/shipments) may import:
 *
 *   • OrderReadService   — the sole cross-module READ boundary. Point /
 *     batch order reads returning deep-frozen ResolvedOrder snapshots.
 *     Consumers MUST NOT re-resolve line data from the live catalog
 *     (ORD-6); the order's own snapshot is authoritative.
 *   • OrderWriteService  — the sole cross-module WRITE boundary. Every
 *     post-DRAFT status change goes through transitionStatus() (ORD-1/
 *     ORD-3); state-machine-guarded, with the documented stock SAGA.
 *
 * Everything else (OrderService, CustomerService, OrderNumberingService,
 * OrderEventWriterService, OrderStateMachineService,
 * RecipientAddressCacheService, AddressValidationService,
 * OrderAdminOverrideService) is INTERNAL Module-6 implementation, held
 * in OrderCoreModule and consumed only by this module's controllers and
 * the order-csv-import submodule. This mirrors Module 5, where
 * inventory-stock exports exactly three services and the rest live in
 * inventory-shared. Convention + module boundary (not lint-enforced) —
 * see phase-1a-debt.
 *
 * OrderReadService / OrderWriteService are provided HERE (not in
 * OrderCoreModule) because NestJS cannot re-export an imported module's
 * provider; their internal deps (OrderStateMachineService /
 * OrderEventWriterService) resolve from the imported OrderCoreModule and
 * StockReservationService from InventoryStockModule (CLAUDE MUST #15).
 * AuditLogService is global (AuthCommonModule @Global).
 */
@Module({
  imports: [
    OrderCoreModule,
    InventoryStockModule,
    // Module 9: OrderWriteService's DISPATCH_STOCK handler (the bug-1
    // fix) issues DISPATCH StockMovements via StockMutationService —
    // the only sanctioned stock writer (INV-1), from inventory-shared.
    InventorySharedModule,
    // The seller's own default for the delivery-fee field (SET-1).
    SettingsModule,
    CallQueueModule,
    ShipmentProvisionModule,
    // Module 11 (NOTIF-5): the R3 lifecycle-event primitive — provides
    // OrderLifecycleEventBus to OrderWriteService for the post-commit
    // emit hook. The order module knows nothing about the
    // notifications module on the other side of the bus.
    LifecycleEventsModule,
    // Cancelling an order before it ships has to give back a delivery
    // fee already taken (an AT_AWB seller is debited at CONFIRMED).
    // Safe to import: seller-wallet-accrual reaches wallet / settings /
    // pricing / inbound-freight and none of them reach back here, so
    // this does not close a cycle.
    SellerWalletAccrualModule,
    SellerRestrictionModule,
  ],
  controllers: [
    SellerOrderController,
    SellerCustomerController,
    SellerRecipientAddressController,
    AdminOrderController,
    SellerOrderDefaultsController,
  ],
  providers: [OrderReadService, OrderWriteService, SellerJwtGuard, StaffJwtGuard],
  exports: [OrderReadService, OrderWriteService],
})
export class OrderModule {}
