import { Module } from '@nestjs/common';
import { CallOutcomeMappingService } from './services/call-outcome-mapping.service';

/**
 * Module 7 — Call Center Workflow.
 *
 * Grows commit-by-commit. Wired into AppModule once it owns controllers
 * + the cross-module integration (later commits). The cross-module
 * surface is intentionally EMPTY — the only externally-consumed
 * primitive (CallQueueService.enqueue/dequeue) lives in the separate
 * `call-queue` shared module (R3), so neither call-center nor order
 * needs the other for the queue primitive.
 */
@Module({
  providers: [CallOutcomeMappingService],
  exports: [CallOutcomeMappingService],
})
export class CallCenterModule {}
