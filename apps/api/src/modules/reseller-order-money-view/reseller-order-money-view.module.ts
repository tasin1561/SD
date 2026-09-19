import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminResellerOrderMoneyController } from './controllers/admin-reseller-order-money.controller';
import { SellerResellerOrderMoneyController } from './controllers/seller-reseller-order-money.controller';
import { StoreOrderMoneyController } from './controllers/store-order-money.controller';
import { ResellerOrderMoneyReadService } from './services/reseller-order-money-read.service';

/**
 * RS-6 phase 3c — the three read faces of a reseller order's money (store,
 * seller, staff). It reads the ledgers directly and WRITES NOTHING.
 *
 * It was a LEAF until 2026-09-19, when RS-7's figure-correction dispute
 * needed to stamp onto the ticket the money AS BOTH SIDES SAW IT at the
 * moment it was raised. `ResellerOrderMoneyReadService` is now exported
 * for exactly that: the alternative was `ticket` re-deriving the same
 * per-party plan and fee split from the ledgers, which is the drift a
 * single reader exists to prevent — the snapshot on the dispute has to be
 * the figures the two parties were looking at on their own screens, and
 * that is only guaranteed if it comes from the same computation.
 *
 * It imports only `AuthCommonModule`, so exporting the read service opens
 * no cycle: `ticket` sits above it and nothing here reaches back.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [
    StoreOrderMoneyController,
    SellerResellerOrderMoneyController,
    AdminResellerOrderMoneyController,
  ],
  providers: [ResellerOrderMoneyReadService, SellerJwtGuard, StaffJwtGuard, StoreJwtGuard],
  exports: [ResellerOrderMoneyReadService],
})
export class ResellerOrderMoneyViewModule {}
