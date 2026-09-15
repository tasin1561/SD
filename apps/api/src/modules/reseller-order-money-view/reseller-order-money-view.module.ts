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
 * seller, staff). A LEAF: nothing imports it, it exports nothing, and it
 * reads the ledgers directly (it writes nothing).
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [
    StoreOrderMoneyController,
    SellerResellerOrderMoneyController,
    AdminResellerOrderMoneyController,
  ],
  providers: [ResellerOrderMoneyReadService, SellerJwtGuard, StaffJwtGuard, StoreJwtGuard],
})
export class ResellerOrderMoneyViewModule {}
