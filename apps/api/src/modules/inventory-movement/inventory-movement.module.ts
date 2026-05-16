import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { AdminMovementController } from './admin-movement.controller';
import { SellerMovementController } from './seller-movement.controller';
import { InventoryMovementService } from './services/inventory-movement.service';

@Module({
  imports: [CatalogReadModule],
  controllers: [SellerMovementController, AdminMovementController],
  providers: [InventoryMovementService, SellerJwtGuard, StaffJwtGuard],
})
export class InventoryMovementModule {}
