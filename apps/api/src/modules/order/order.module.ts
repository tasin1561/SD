import { Module } from '@nestjs/common';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerOrderController } from './controllers/seller-order.controller';
import { SellerCustomerController } from './controllers/seller-customer.controller';
import { SellerRecipientAddressController } from './controllers/seller-recipient-address.controller';
import { AdminOrderController } from './controllers/admin-order.controller';
import { OrderNumberingService } from './services/order-numbering.service';
import { OrderStateMachineService } from './services/order-state-machine.service';
import { OrderEventWriterService } from './services/order-event-writer.service';
import { CustomerService } from './services/customer.service';
import { RecipientAddressCacheService } from './services/recipient-address-cache.service';
import { AddressValidationService } from './services/address-validation.service';
import { OrderService } from './services/order.service';
import { OrderWriteService } from './services/order-write.service';
import { OrderReadService } from './services/order-read.service';

/**
 * Module 6 — Order Management.
 *
 * Grows commit-by-commit. The sanctioned cross-module surface will be
 * exactly OrderReadService + OrderWriteService (added + exported later);
 * everything else stays internal. Wired into AppModule once it owns
 * controllers (commit 11). AuditLogService is provided globally
 * (AuthCommonModule @Global); CatalogReadModule is the sanctioned
 * cross-module variant read boundary (CLAUDE MUST #13).
 */
@Module({
  imports: [CatalogReadModule, InventoryStockModule],
  controllers: [
    SellerOrderController,
    SellerCustomerController,
    SellerRecipientAddressController,
    AdminOrderController,
  ],
  providers: [
    OrderNumberingService,
    OrderStateMachineService,
    OrderEventWriterService,
    CustomerService,
    RecipientAddressCacheService,
    AddressValidationService,
    OrderService,
    OrderWriteService,
    OrderReadService,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
  exports: [
    OrderNumberingService,
    OrderStateMachineService,
    OrderEventWriterService,
    CustomerService,
    RecipientAddressCacheService,
    AddressValidationService,
    OrderService,
    OrderWriteService,
    OrderReadService,
  ],
})
export class OrderModule {}
