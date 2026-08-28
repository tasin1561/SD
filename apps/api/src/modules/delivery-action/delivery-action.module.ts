import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { CourierOpsModule } from '../courier-ops/courier-ops.module';
import { AdminDeliveryActionController } from './controllers/admin-delivery-action.controller';
import { SellerDeliveryActionController } from './controllers/seller-delivery-action.controller';
import { DeliveryActionDecisionService } from './services/delivery-action-decision.service';
import { DeliveryActionService } from './services/delivery-action.service';
import { DeliveryFailedListener } from './services/delivery-failed-listener.service';
import { SellerCallHistoryService } from './services/seller-call-history.service';

/**
 * What a seller can ask for when a delivery fails, and the operator who
 * decides.
 *
 * A LEAF: nothing imports it. It imports `courier-ops` for the one
 * service that can actually reach Delhivery, and `call-queue` for RECALL
 * — which never leaves the building. Direction is one-way; neither
 * imports this back.
 */
@Module({
  imports: [AuthCommonModule, CallQueueModule, CourierOpsModule, LifecycleEventsModule],
  controllers: [SellerDeliveryActionController, AdminDeliveryActionController],
  providers: [
    DeliveryActionService,
    DeliveryActionDecisionService,
    DeliveryFailedListener,
    SellerCallHistoryService,
  ],
})
export class DeliveryActionModule {}
