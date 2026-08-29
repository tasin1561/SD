import { Module } from '@nestjs/common';
import { AdminOrderJourneyController } from './controllers/admin-order-journey.controller';
import { SellerOrderJourneyController } from './controllers/seller-order-journey.controller';
import { OrderJourneyService } from './services/order-journey.service';
import { NslInterpretationService } from '../tracking-events/services/nsl-interpretation.service';

/**
 * Module — the order journey (read-only).
 *
 * A LEAF: nothing imports it and it exports nothing. It owns no state
 * and writes nothing; every fact it returns already exists in
 * `order_events`, on the shipment, or in `tracking_events`, and it
 * reads all three so no fourth copy can disagree with them.
 */
@Module({
  controllers: [SellerOrderJourneyController, AdminOrderJourneyController],
  providers: [OrderJourneyService, NslInterpretationService],
})
export class OrderJourneyModule {}
