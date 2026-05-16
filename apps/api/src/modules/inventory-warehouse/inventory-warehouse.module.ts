import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { AdminWarehouseController } from './admin-warehouse.controller';
import { InventoryWarehouseService } from './services/inventory-warehouse.service';

@Module({
  imports: [InventorySharedModule],
  controllers: [AdminWarehouseController],
  providers: [InventoryWarehouseService, StaffJwtGuard],
  exports: [InventoryWarehouseService],
})
export class InventoryWarehouseModule {}
