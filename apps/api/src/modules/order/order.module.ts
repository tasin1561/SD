import { Module } from '@nestjs/common';
import { OrderNumberingService } from './services/order-numbering.service';
import { OrderStateMachineService } from './services/order-state-machine.service';
import { OrderEventWriterService } from './services/order-event-writer.service';
import { CustomerService } from './services/customer.service';
import { RecipientAddressCacheService } from './services/recipient-address-cache.service';
import { AddressValidationService } from './services/address-validation.service';

/**
 * Module 6 — Order Management.
 *
 * Grows commit-by-commit. The sanctioned cross-module surface will be
 * exactly OrderReadService + OrderWriteService (added + exported later);
 * everything else stays internal. Wired into AppModule once it owns
 * controllers (commit 11).
 */
@Module({
  providers: [
    OrderNumberingService,
    OrderStateMachineService,
    OrderEventWriterService,
    CustomerService,
    RecipientAddressCacheService,
    AddressValidationService,
  ],
  exports: [
    OrderNumberingService,
    OrderStateMachineService,
    OrderEventWriterService,
    CustomerService,
    RecipientAddressCacheService,
    AddressValidationService,
  ],
})
export class OrderModule {}
