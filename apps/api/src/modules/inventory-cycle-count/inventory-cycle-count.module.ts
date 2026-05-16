import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { AdminCycleCountController } from './admin-cycle-count.controller';
import { CycleCountService } from './services/cycle-count.service';

/**
 * Admin-only cycle counts. Completion generates PENDING CYCLE_COUNT
 * adjustment drafts (created as plain rows); they flow through the normal
 * adjustment approve -> executor path, so this module needs no stock
 * writer of its own.
 */
@Module({
  imports: [InventorySharedModule],
  controllers: [AdminCycleCountController],
  providers: [CycleCountService, StaffJwtGuard],
  exports: [CycleCountService],
})
export class InventoryCycleCountModule {}
