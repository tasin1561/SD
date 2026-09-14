import { Module } from '@nestjs/common';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { ResellerStockGateService } from './services/reseller-stock-gate.service';

/**
 * RS-5 — the reseller set-aside gate, a dependency-free R3 primitive.
 *
 * Imported by the ORDER module (confirmation reserves through its guard;
 * store order create reads its offers) and by the RESELLER CATALOGUE
 * module (a store's consumption of its set-aside). It imports only the
 * catalogue read boundary (MUST #13) and inventory-stock's sanctioned
 * surface (MUST #15) — never order, never reseller-catalogue — so wiring
 * it into both closes no cycle and needs no `forwardRef`.
 */
@Module({
  imports: [CatalogReadModule, InventoryStockModule],
  providers: [ResellerStockGateService],
  exports: [ResellerStockGateService],
})
export class ResellerOrderGateModule {}
