import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CallCenterModule } from '../call-center/call-center.module';
import { CourierEscalationModule } from '../courier-escalation/courier-escalation.module';
import { AddressCheckModule } from '../address-check/address-check.module';
import { AdminReportsModule } from '../admin-reports/admin-reports.module';
import { ConsignmentModule } from '../consignment/consignment.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { OrderChargesModule } from '../order-charges/order-charges.module';
import { OrderJourneyModule } from '../order-journey/order-journey.module';
import { OrderModule } from '../order/order.module';
import { ResellerOrderModule } from '../reseller-order/reseller-order.module';
import { SellerRestrictionModule } from '../seller-restriction/seller-restriction.module';
import { SellerTrackingModule } from '../seller-tracking/seller-tracking.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { TicketModule } from '../ticket/ticket.module';
import { TrackingPublicModule } from '../tracking-public/tracking-public.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { AdminAssistantPanelController } from './controllers/admin-assistant-panel.controller';
import { AdminAssistantRecommendationsController } from './controllers/admin-assistant-recommendations.controller';
import { AssistantRecommendationWorker } from './queue/assistant-recommendation.worker';
import { AssistantEvalGateService } from './services/assistant-eval-gate.service';
import { AssistantGithubIssueService } from './services/assistant-github-issue.service';
import { AssistantKnowledgeService } from './services/assistant-knowledge.service';
import { AssistantRecommendationService } from './services/assistant-recommendation.service';
import { AssistantMonitorWorker } from './queue/assistant-monitor.worker';
import { AssistantRetentionWorker } from './queue/assistant-retention.worker';
import { AssistantBillingService } from './services/assistant-billing.service';
import { AssistantFeedbackService } from './services/assistant-feedback.service';
import { AnthropicBatchGateway, AssistantBatchGateway } from './services/assistant-batch-gateway';
import { AssistantMonitorDigestService } from './services/assistant-monitor-digest.service';
import { AssistantMonitorPanelService } from './services/assistant-monitor-panel.service';
import { AssistantMonitorService } from './services/assistant-monitor.service';
import { AssistantPanelService } from './services/assistant-panel.service';
import { AssistantPublicService } from './services/assistant-public.service';
import { AssistantRetentionService } from './services/assistant-retention.service';
import { AdminAssistantController } from './controllers/admin-assistant.controller';
import { PublicParcelAssistantController } from './controllers/public-parcel-assistant.controller';
import { PublicParcelAwbThrottleGuard } from './controllers/public-parcel-awb-throttle.guard';
import { SellerAssistantController } from './controllers/seller-assistant.controller';
import { StoreAssistantController } from './controllers/store-assistant.controller';
import { AssistantAttachmentService } from './services/assistant-attachment.service';
import { AssistantBudgetAlertService } from './services/assistant-budget-alert.service';
import { AssistantBudgetService } from './services/assistant-budget.service';
import { AssistantChatService } from './services/assistant-chat.service';
import { AssistantConversationService } from './services/assistant-conversation.service';
import { AssistantHelpService } from './services/assistant-help.service';
import { AnthropicModelGateway, AssistantModelGateway } from './services/assistant-model-gateway';
import { AssistantStoreService } from './services/assistant-store.service';
import { AssistantTicketService } from './services/assistant-ticket.service';
import { AssistantTicketPhotosService } from './services/assistant-ticket-photos.service';
import { AssistantStatusService } from './services/assistant-status.service';
import { AssistantToolRegistry } from './services/assistant-tool-registry.service';

/**
 * The in-app AI assistant: backend core, READ-ONLY, plus (phase D) one
 * thing it can START and only a person can finish: a support ticket the
 * person confirms with a button (`AssistantTicketService`).
 *
 * A LEAF: nothing imports it. It reaches other domains only through the
 * services their own modules export (order, seller tracking, the wallet's
 * balance read, store orders, the call-queue stats), each called with the
 * caller's scope as an argument, exactly as the controllers call them.
 * It writes nothing outside its own tables (and, on a button press, the ticket through the ticket module) (and the `assistant/` prefix of the private bucket).
 *
 * `ANTHROPIC_API_KEY` is read lazily by the gateway; with it unset the
 * module still boots and the assistant answers "not configured".
 */
@Module({
  imports: [
    AuthCommonModule,
    OrderModule,
    SellerTrackingModule,
    SellerRestrictionModule,
    SellerWalletModule,
    ResellerOrderModule,
    CallCenterModule,
    SystemSettingsModule,
    // Phase D: the confirm button raises a ticket through the console's own service.
    TicketModule,
    CourierEscalationModule,
    // Batch B: read-only lookups, each through its module's own
    // `*-assistant-read.service` (charges, stock, consignments, failed
    // deliveries, address checks, ops numbers).
    OrderChargesModule,
    InventoryStockModule,
    ConsignmentModule,
    OrderJourneyModule,
    AddressCheckModule,
    AdminReportsModule,
    // The monitor's weekly e-mail goes through the dispatcher the system-issue alerts use.
    NotificationAudienceModule,
    // Batch C: the public parcel helper reads the tracking page's own projection.
    TrackingPublicModule,
  ],
  controllers: [
    AdminAssistantController,
    AdminAssistantPanelController,
    AdminAssistantRecommendationsController,
    SellerAssistantController,
    StoreAssistantController,
    PublicParcelAssistantController,
  ],
  providers: [
    AssistantStoreService,
    AssistantKnowledgeService,
    AssistantEvalGateService,
    AssistantRecommendationService,
    AssistantGithubIssueService,
    AssistantRecommendationWorker,
    AssistantAttachmentService,
    AssistantBudgetService,
    AssistantBudgetAlertService,
    AssistantHelpService,
    AssistantToolRegistry,
    AssistantTicketService,
    AssistantTicketPhotosService,
    AssistantStatusService,
    AssistantChatService,
    AssistantPublicService,
    PublicParcelAwbThrottleGuard,
    AssistantConversationService,
    AssistantFeedbackService,
    AssistantBillingService,
    AssistantPanelService,
    AssistantRetentionService,
    AssistantRetentionWorker,
    AssistantMonitorService,
    AssistantMonitorPanelService,
    AssistantMonitorDigestService,
    AssistantMonitorWorker,
    { provide: AssistantBatchGateway, useClass: AnthropicBatchGateway },
    { provide: AssistantModelGateway, useClass: AnthropicModelGateway },
  ],
})
export class AssistantModule {}
