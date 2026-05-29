import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminOrderChargesController } from './controllers/admin-order-charges.controller';
import { SellerOrderChargesController } from './controllers/seller-order-charges.controller';
import { OrderChargesService } from './services/order-charges.service';

/**
 * Module 17 — Order Charges. Read endpoints (admin sees all,
 * seller sees isVisibleToSeller=true only) + the admin "compute &
 * persist" action that closes the M15 fast-follow at the order
 * level. The seller order-detail UI lights up once charges are
 * persisted (no charges → empty section).
 *
 * A future M6 order-create hook can call
 * OrderChargesService.persistForOrder() post-commit so newly-
 * created orders auto-persist their charges; that integration is
 * still a fast-follow (touches OrderService.create's saga).
 */
@Module({
  imports: [AuthCommonModule, PricingModule],
  controllers: [AdminOrderChargesController, SellerOrderChargesController],
  providers: [OrderChargesService, StaffJwtGuard, SellerJwtGuard],
  exports: [OrderChargesService],
})
export class OrderChargesModule {}
