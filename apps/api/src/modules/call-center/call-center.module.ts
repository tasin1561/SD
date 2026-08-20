import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { OrderModule } from '../order/order.module';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { CallOutcomeMappingService } from './services/call-outcome-mapping.service';
import { AgentPresenceService } from './services/agent-presence.service';
import { AgentPresenceQueue } from './queue/agent-presence.queue';
import { AgentPresenceWorker } from './queue/agent-presence.worker';
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
  imports: [OrderModule, CallQueueModule, EarlyReservationModule, SettingsModule],
  controllers: [
    AgentSettingsController,
    AgentCallController,
    AdminCallQueueController,
    AdminAgentController,
  ],
  providers: [
    CallOutcomeMappingService,
    AgentPresenceService,
    AgentPresenceQueue,
    AgentPresenceWorker,
    CallAssignmentService,
    CallAttemptService,
    AgentSettingsService,
    AdminCallQueueService,
    AdminAgentService,
    AssignmentExpirationService,
    AssignmentExpirationQueue,
    AssignmentExpirationWorker,
    StaffJwtGuard,
  ],
  exports: [CallOutcomeMappingService],
})
export class CallCenterModule {}
