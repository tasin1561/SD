import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { DispatchHandoffService } from './services/dispatch-handoff.service';

/**
 * Module 9 — courier-dispatch: per-manifest dispatch handoff (CP3).
 *   - commit 11 (this): DispatchHandoffService — supervisor handoff
 *                       confirmation (CUR-4)
 *   - commit 13       : + supervisor dispatch endpoints
 *
 * Imports OrderModule (OrderWriteService — the PENDING_DISPATCH →
 * DISPATCHED transition; commit 12 wires the DISPATCH_STOCK side-effect
 * onto that edge — the bug-1 fix). PrismaService + AuditLogService
 * global.
 */
@Module({
  imports: [OrderModule],
  providers: [DispatchHandoffService],
  exports: [DispatchHandoffService],
})
export class CourierDispatchModule {}
