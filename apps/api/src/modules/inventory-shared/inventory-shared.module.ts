import { Module } from '@nestjs/common';
import { WarehouseResolverService } from './warehouse-resolver.service';
import { StockMutationService } from './stock-mutation.service';

/**
 * Shared inventory primitives consumed by every inventory-* module.
 * No controllers — pure provider/export surface (the catalog-read
 * pattern). StockMutationService is the single sanctioned stock writer
 * (INV-1); every inventory-* module mutates stock only through it.
 */
@Module({
  providers: [WarehouseResolverService, StockMutationService],
  exports: [WarehouseResolverService, StockMutationService],
})
export class InventorySharedModule {}
