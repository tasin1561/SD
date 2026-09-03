import { Module } from '@nestjs/common';
import { SellerRestrictionModule } from '../seller-restriction/seller-restriction.module';
import { OrderModule } from '../order/order.module';
import { DispatchHandoffService } from './services/dispatch-handoff.service';
import { DispatchController } from './controllers/dispatch.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';

/**
 * Module 9 — courier-dispatch: per-manifest dispatch handoff (CP3).
 *   - commit 11: DispatchHandoffService — supervisor handoff
 *               confirmation (CUR-4)
 *   - commit 13 (this): + DispatchController — the supervisor HTTP
 *               surface (POST .../confirm-handoff, WAREHOUSE_SUPERVISOR)
 *
 * Imports OrderModule (OrderWriteService — the PENDING_DISPATCH →
 * DISPATCHED transition). Model C (2026-09-03) moved the DISPATCH_STOCK
 * side-effect off this edge and onto PICKED → PACKED, so this handoff no
 * longer touches qtyOnHand at all — the decrement already happened when
 * the box was packed. PrismaService + AuditLogService global.
 *
 * LEAF consumer — nothing imports `courier-dispatch`.
 */
@Module({
  imports: [OrderModule, InventorySharedModule, SellerRestrictionModule],
  controllers: [DispatchController],
  providers: [DispatchHandoffService, StaffJwtGuard],
  exports: [DispatchHandoffService],
})
export class CourierDispatchModule {}
