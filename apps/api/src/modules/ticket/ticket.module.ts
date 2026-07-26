import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { AdminTicketController } from './controllers/admin-ticket.controller';
import { SellerTicketController } from './controllers/seller-ticket.controller';
import { TicketService } from './services/ticket.service';
import { TicketStateMachineService } from './services/ticket-state-machine.service';

/**
 * R7 — unified ticket system (scrap/damage + seller-raised issues).
 * Exports `TicketService` so `warehouse-rto` can auto-raise a
 * SCRAP_DAMAGE ticket inside its inspection transaction.
 */
@Module({
  imports: [AuthCommonModule, SellerWalletModule],
  controllers: [SellerTicketController, AdminTicketController],
  providers: [TicketService, TicketStateMachineService, SellerJwtGuard, StaffJwtGuard],
  exports: [TicketService],
})
export class TicketModule {}
