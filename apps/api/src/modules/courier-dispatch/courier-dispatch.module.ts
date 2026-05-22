import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { DispatchHandoffService } from './services/dispatch-handoff.service';
import { DispatchController } from './controllers/dispatch.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';

/**
 * Module 9 — courier-dispatch: per-manifest dispatch handoff (CP3).
 *   - commit 11: DispatchHandoffService — supervisor handoff
 *               confirmation (CUR-4)
 *   - commit 13 (this): + DispatchController — the supervisor HTTP
 *               surface (POST .../confirm-handoff, WAREHOUSE_SUPERVISOR)
 *
 * Imports OrderModule (OrderWriteService — the PENDING_DISPATCH →
 * DISPATCHED transition; commit 12 wired the DISPATCH_STOCK side-effect
 * onto that edge — the bug-1 fix). PrismaService + AuditLogService
 * global.
 *
 * LEAF consumer — nothing imports `courier-dispatch`.
 */
@Module({
  imports: [OrderModule],
  controllers: [DispatchController],
  providers: [DispatchHandoffService, StaffJwtGuard],
  exports: [DispatchHandoffService],
})
export class CourierDispatchModule {}
