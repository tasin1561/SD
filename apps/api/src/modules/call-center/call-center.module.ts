import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { CallQueueModule } from '../call-queue/call-queue.module';
import { CallOutcomeMappingService } from './services/call-outcome-mapping.service';
import { CallAssignmentService } from './services/call-assignment.service';
import { CallAttemptService } from './services/call-attempt.service';
import { AssignmentExpirationService } from './services/assignment-expiration.service';
import { AssignmentExpirationQueue } from './queue/assignment-expiration.queue';
import { AssignmentExpirationWorker } from './queue/assignment-expiration.worker';

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
  imports: [OrderModule, CallQueueModule],
  providers: [
    CallOutcomeMappingService,
    CallAssignmentService,
    CallAttemptService,
    AssignmentExpirationService,
    AssignmentExpirationQueue,
    AssignmentExpirationWorker,
  ],
  exports: [CallOutcomeMappingService],
})
export class CallCenterModule {}
