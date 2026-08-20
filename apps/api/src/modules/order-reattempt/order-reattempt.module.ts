import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { OrderReattemptService } from './services/order-reattempt.service';
import { AdminReattemptController } from './controllers/admin-reattempt.controller';
import { SellerReattemptController } from './controllers/seller-reattempt.controller';

/**
 * The one path out of REJECTED_BY_CUSTOMER — a seller's request and an
 * admin's decision. LEAF: nothing imports it, and it exports nothing.
 * Consumes the sanctioned order boundaries (OrderReadService /
 * OrderWriteService.transitionStatus, ORD-3) like every other domain.
 */
@Module({
  imports: [OrderModule],
  controllers: [AdminReattemptController, SellerReattemptController],
  providers: [OrderReattemptService],
})
export class OrderReattemptModule {}
