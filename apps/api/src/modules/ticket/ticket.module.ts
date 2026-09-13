import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { AdminTicketController } from './controllers/admin-ticket.controller';
import { SellerTicketController } from './controllers/seller-ticket.controller';
import { TicketService } from './services/ticket.service';
import { TicketStateMachineService } from './services/ticket-state-machine.service';
import { TicketNotifier } from './services/ticket-notifier.service';
import { CourierEscalationModule } from '../courier-escalation/courier-escalation.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { SellerNotificationPreferenceModule } from '../seller-notification-preference/seller-notification-preference.module';

/**
 * R7 — unified ticket system (scrap/damage + seller-raised issues).
 * Exports `TicketService` so `warehouse-rto` can auto-raise a
 * SCRAP_DAMAGE ticket inside its inspection transaction.
 */
@Module({
  imports: [
    AuthCommonModule,
    SellerWalletModule,
    // A seller raising an issue now opens the courier conversation for
    // it. No cycle: courier-escalation imports nothing from here.
    CourierEscalationModule,
    // TKT-3: a ticket event tells the other side. In-app through the
    // audience dispatcher, the company's email through the ledger, both
    // gated by the company's own preference. None of the three imports
    // anything ticket-shaped, so there is no cycle.
    NotificationAudienceModule,
    NotificationLedgerModule,
    SellerNotificationPreferenceModule,
  ],
  controllers: [SellerTicketController, AdminTicketController],
  providers: [
    TicketService,
    TicketStateMachineService,
    TicketNotifier,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
  exports: [TicketService],
})
export class TicketModule {}
