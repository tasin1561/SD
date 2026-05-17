import { Module } from '@nestjs/common';
import { OrderNumberingService } from './services/order-numbering.service';

/**
 * Module 6 — Order Management.
 *
 * Grows commit-by-commit. The sanctioned cross-module surface will be
 * exactly OrderReadService + OrderWriteService (added + exported later);
 * everything else stays internal. Wired into AppModule once it owns
 * controllers (commit 11).
 */
@Module({
  providers: [OrderNumberingService],
  exports: [OrderNumberingService],
})
export class OrderModule {}
