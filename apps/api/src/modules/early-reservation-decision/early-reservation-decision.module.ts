import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EarlyReservationModule } from '../early-reservation/early-reservation.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { OrderModule } from '../order/order.module';
import { SettingsModule } from '../settings/settings.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { EarlyReservationDecisionService } from './services/early-reservation-decision.service';
import { ReviewExpirySweepService } from './services/review-expiry-sweep.service';
import { SellerReviewDecisionController } from './controllers/seller-review-decision.controller';
import { ReviewExpiryQueue } from './queue/review-expiry.queue';
import { ReviewExpiryWorker } from './queue/review-expiry.worker';

/**
 * R5b — applies a seller's call-cap decision to BOTH the review row and
 * the order, and expires reviews nobody answered.
 *
 * A LEAF module by necessity: it imports `order` AND `early-reservation`,
 * and `order` already imports `early-reservation`. Nothing imports this
 * module, so composing the two here cannot create a cycle — the R3
 * extraction rule's answer to "the transition boundary is not
 * extractable". Exports nothing.
 */
@Module({
  imports: [
    AuthCommonModule,
    EarlyReservationModule,
    InventoryStockModule,
    OrderModule,
    SettingsModule,
  ],
  controllers: [SellerReviewDecisionController],
  providers: [
    EarlyReservationDecisionService,
    ReviewExpirySweepService,
    ReviewExpiryQueue,
    ReviewExpiryWorker,
    SellerJwtGuard,
  ],
})
export class EarlyReservationDecisionModule {}
