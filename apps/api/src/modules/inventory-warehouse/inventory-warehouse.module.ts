import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { AdminBinContentsController } from './admin-bin-contents.controller';
import { AdminWarehouseController } from './admin-warehouse.controller';
import { BinContentsService } from './services/bin-contents.service';
import { InventoryWarehouseService } from './services/inventory-warehouse.service';

@Module({
  // InventoryStockModule: the sanctioned stock read surface for bin contents.
  // CatalogReadModule: product/SKU names for those lines (MUST #13).
  imports: [InventorySharedModule, InventoryStockModule, CatalogReadModule],
  controllers: [AdminWarehouseController, AdminBinContentsController],
  providers: [InventoryWarehouseService, BinContentsService, StaffJwtGuard],
  exports: [InventoryWarehouseService],
})
export class InventoryWarehouseModule {}
