import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { OrderCoreModule } from './order-core.module';
import { SellerOrderController } from './controllers/seller-order.controller';
import { SellerCustomerController } from './controllers/seller-customer.controller';
import { SellerRecipientAddressController } from './controllers/seller-recipient-address.controller';
import { AdminOrderController } from './controllers/admin-order.controller';
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
  imports: [OrderCoreModule, InventoryStockModule],
  controllers: [
    SellerOrderController,
    SellerCustomerController,
    SellerRecipientAddressController,
    AdminOrderController,
  ],
  providers: [OrderReadService, OrderWriteService, SellerJwtGuard, StaffJwtGuard],
  exports: [OrderReadService, OrderWriteService],
})
export class OrderModule {}
