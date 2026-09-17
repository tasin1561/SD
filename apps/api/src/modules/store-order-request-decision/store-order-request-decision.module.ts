import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EarlyReservationDecisionModule } from '../early-reservation-decision/early-reservation-decision.module';
import { OrderModule } from '../order/order.module';
import { StoreOrderRequestModule } from '../store-order-request/store-order-request.module';
import { TicketModule } from '../ticket/ticket.module';
import { SellerStoreOrderRequestController } from './controllers/seller-store-order-request.controller';
import { SellerStoreOrderRequestDecisionService } from './services/seller-store-order-request-decision.service';

/**
 * 2026-09-17 — seller staff approving or rejecting a reseller store's
 * held cancel / call-cap answer / issue with Skydrop.
 *
 * A LEAF: nothing imports it and it exports nothing. It composes the
 * three modules whose services a DIRECT request already calls, so an
 * approved request is carried out by the same code — which is only
 * possible from a module none of them import back.
 */
@Module({
  imports: [
    AuthCommonModule,
    OrderModule,
    EarlyReservationDecisionModule,
    TicketModule,
    StoreOrderRequestModule,
  ],
  controllers: [SellerStoreOrderRequestController],
  providers: [SellerStoreOrderRequestDecisionService, SellerJwtGuard],
})
export class StoreOrderRequestDecisionModule {}
