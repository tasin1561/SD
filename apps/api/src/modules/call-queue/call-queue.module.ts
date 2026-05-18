import { Module } from '@nestjs/common';
import { CallQueueService } from './services/call-queue.service';

/**
 * Module 7 — the shared queue PRIMITIVE module (R3).
 *
 * Exports `CallQueueService` (enqueueOrder / enqueueAgain /
 * dequeueOrder) for BOTH `call-center` and `order` to import. It depends
 * on neither — that one-way fan-in is exactly what removes the
 * order ↔ call-center circular module dependency. PrismaService and
 * AuditLogService are global.
 */
@Module({
  providers: [CallQueueService],
  exports: [CallQueueService],
})
export class CallQueueModule {}
