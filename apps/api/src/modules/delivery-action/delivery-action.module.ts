import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { CourierOpsModule } from '../courier-ops/courier-ops.module';
import { CourierEscalationModule } from '../courier-escalation/courier-escalation.module';
import { TicketModule } from '../ticket/ticket.module';
import { ResellerStoreModule } from '../reseller-store/reseller-store.module';
import { AdminDeliveryActionController } from './controllers/admin-delivery-action.controller';
import { SellerDeliveryActionController } from './controllers/seller-delivery-action.controller';
import { SellerStoreActionController } from './controllers/seller-store-action.controller';
import { StoreDeliveryActionController } from './controllers/store-delivery-action.controller';
import { DeliveryActionDecisionService } from './services/delivery-action-decision.service';
import { DeliveryActionService } from './services/delivery-action.service';
import { StoreDeliveryActionService } from './services/store-delivery-action.service';
import { SellerStoreActionDecisionService } from './services/seller-store-action-decision.service';
import { StoreActionNotifier } from './services/store-action-notifier.service';
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
  imports: [
    AuthCommonModule,
    CallQueueModule,
    CourierOpsModule,
    // A re-attempt and a recall are TICKETS, not API calls; a re-attempt
    // additionally opens the courier conversation an operator sends by
    // hand. Direction stays one-way — neither imports this back.
    TicketModule,
    CourierEscalationModule,
    LifecycleEventsModule,
    // 2026-09-16 — a reseller store's own asks are routed by the policy
    // the SELLER set for that store. One-way: `reseller-store` imports
    // nothing from here.
    ResellerStoreModule,
    // The store hears an answer by EMAIL (it has no inbox); the seller
    // hears in-app that somebody is waiting on them.
    NotificationAudienceModule,
    NotificationLedgerModule,
  ],
  controllers: [
    SellerDeliveryActionController,
    AdminDeliveryActionController,
    // 2026-09-16 — the store asks; the seller decides the ones their
    // policy marked "ask me first".
    StoreDeliveryActionController,
    SellerStoreActionController,
  ],
  providers: [
    DeliveryActionService,
    DeliveryActionDecisionService,
    StoreDeliveryActionService,
    SellerStoreActionDecisionService,
    StoreActionNotifier,
    DeliveryFailedListener,
    SellerCallHistoryService,
  ],
})
export class DeliveryActionModule {}
