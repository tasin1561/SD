import { Module } from '@nestjs/common';
import { WarehouseResolverService } from './warehouse-resolver.service';

/**
 * Shared inventory primitives consumed by every inventory-* module.
 * No controllers — pure provider/export surface (the catalog-read
 * pattern). StockMutationService (the single stock writer) is added here
 * in commit 6.
 */
@Module({
  providers: [WarehouseResolverService],
  exports: [WarehouseResolverService],
})
export class InventorySharedModule {}
