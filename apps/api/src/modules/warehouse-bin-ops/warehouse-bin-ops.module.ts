import { Module } from '@nestjs/common';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { EmailModule } from '../email/email.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminBinOpsController } from './controllers/admin-bin-ops.controller';
import { BinCollapseService } from './services/bin-collapse.service';
import { BinBulkTransferService } from './services/bin-bulk-transfer.service';
import { BinSnapshotSweepService } from './queue/bin-snapshot-sweep.service';

/**
 * Re-shelving stock, and the destructive collapse back to one location.
 *
 * A LEAF module — nothing imports it and it exports nothing. Both
 * services write stock exclusively through `StockMutationService`
 * (INV-1); neither touches `stock_levels` directly.
 */
@Module({
  imports: [InventorySharedModule, EmailModule],
  controllers: [AdminBinOpsController],
  providers: [BinCollapseService, BinBulkTransferService, BinSnapshotSweepService, StaffJwtGuard],
})
export class WarehouseBinOpsModule {}
