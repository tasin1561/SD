import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CallCenterModule } from '../call-center/call-center.module';
import { CourierEscalationModule } from '../courier-escalation/courier-escalation.module';
import { OrderModule } from '../order/order.module';
import { ResellerOrderModule } from '../reseller-order/reseller-order.module';
import { SellerRestrictionModule } from '../seller-restriction/seller-restriction.module';
import { SellerTrackingModule } from '../seller-tracking/seller-tracking.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { TicketModule } from '../ticket/ticket.module';
import { AdminAssistantController } from './controllers/admin-assistant.controller';
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
  ],
  controllers: [AdminAssistantController, SellerAssistantController, StoreAssistantController],
  providers: [
    AssistantStoreService,
    AssistantAttachmentService,
    AssistantBudgetService,
    AssistantBudgetAlertService,
    AssistantHelpService,
    AssistantToolRegistry,
    AssistantTicketService,
    AssistantChatService,
    AssistantConversationService,
    { provide: AssistantModelGateway, useClass: AnthropicModelGateway },
  ],
})
export class AssistantModule {}
