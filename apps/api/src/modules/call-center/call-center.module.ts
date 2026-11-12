import { Module } from '@nestjs/common';
import { TicketModule } from '../ticket/ticket.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { SettingsModule } from '../settings/settings.module';
import { OrderModule } from '../order/order.module';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { CallOutcomeMappingService } from './services/call-outcome-mapping.service';
import { AgentPresenceService } from './services/agent-presence.service';
import { CallHoldService } from './services/call-hold.service';
import { CallCapService } from './services/call-cap.service';
import { AgentPresenceQueue } from './queue/agent-presence.queue';
import { AgentPresenceWorker } from './queue/agent-presence.worker';
import { CallRecipientCorrectionService } from './services/call-recipient-correction.service';
import { CallAssignmentService } from './services/call-assignment.service';
import { CallAttemptService } from './services/call-attempt.service';
import { AgentSettingsService } from './services/agent-settings.service';
import { AdminCallQueueService } from './services/admin-call-queue.service';
import { AdminAgentService } from './services/admin-agent.service';
import { AssignmentExpirationService } from './services/assignment-expiration.service';
import { AssignmentExpirationQueue } from './queue/assignment-expiration.queue';
import { AssignmentExpirationWorker } from './queue/assignment-expiration.worker';
import { AgentSettingsController } from './controllers/agent-settings.controller';
import { AgentCallController } from './controllers/agent-call.controller';
import { AdminCallQueueController } from './controllers/admin-call-queue.controller';
import { AdminAgentController } from './controllers/admin-agent.controller';
import { ConfirmationPolicyModule } from '../confirmation-policy/confirmation-policy.module';
import { ConfirmationTtlSweeperService } from './services/confirmation-ttl-sweeper.service';
import { ConfirmationTtlQueue } from './queue/confirmation-ttl.queue';
import { ConfirmationTtlWorker } from './queue/confirmation-ttl.worker';
import { EarlyReservationModule } from '../early-reservation/early-reservation.module';

/**
 * Module 7 — Call Center Workflow.
 *
 * Grows commit-by-commit. Imports the Order facade (OrderModule —
 * exports only OrderReadService + OrderWriteService) for assignment
 * enrichment / the post-commit saga. It does NOT import the
 * `call-queue` primitive's consumers and `order` never imports this —
 * the R3 split keeps the module graph acyclic.
 *
 * Imports the shared `call-queue` PRIMITIVE module (R3) so the attempt
 * recorder can re-queue (enqueueAgain) post-commit; `call-queue` depends
 * on neither side, keeping the graph acyclic.
 *
 * Cross-module export surface is intentionally EMPTY: the only
 * externally-consumed primitive (CallQueueService) lives in the
 * separate `call-queue` module. CallOutcomeMappingService is exported
 * only for intra-module use by later call-center services.
 */
@Module({
  // CatalogReadModule: the sanctioned cross-module catalog read
  // boundary (MUST #13) — the agent's card shows the product picture and
  // description, which the ORD-6 order snapshot deliberately does not
  // carry.
  imports: [
    OrderModule,
    CallQueueModule,
    EarlyReservationModule,
    // The no-call TTL auto-confirm sweep (ops.call_confirmation_required).
    ConfirmationPolicyModule,
    SettingsModule,
    CatalogReadModule,
    // The agent needs to know WHY they are calling, and whoever
    // asked needs to be told what happened. Both live on the ticket.
    TicketModule,
  ],
  controllers: [
    AgentSettingsController,
    AgentCallController,
    AdminCallQueueController,
    AdminAgentController,
  ],
  providers: [
    CallOutcomeMappingService,
    AgentPresenceService,
    CallHoldService,
    CallCapService,
    AgentPresenceQueue,
    AgentPresenceWorker,
    CallAssignmentService,
    CallRecipientCorrectionService,
    CallAttemptService,
    AgentSettingsService,
    AdminCallQueueService,
    AdminAgentService,
    AssignmentExpirationService,
    AssignmentExpirationQueue,
    AssignmentExpirationWorker,
    ConfirmationTtlSweeperService,
    ConfirmationTtlQueue,
    ConfirmationTtlWorker,
    StaffJwtGuard,
  ],
  // AdminCallQueueService.stats(): read by the in-app assistant's staff
  // `get_ops_queue_counts` tool, behind the same `callcenter.queue.view`.
  exports: [CallOutcomeMappingService, AdminCallQueueService],
})
export class CallCenterModule {}
