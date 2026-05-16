import { Module } from '@nestjs/common';
import { CatalogAttributeModule } from '../catalog-attribute/catalog-attribute.module';
import { CatalogReadService } from './services/catalog-read.service';

/**
 * The sanctioned cross-module catalog read boundary. No controllers —
 * other domain modules (orders, pricing, shipments, WMS) import this and
 * consume CatalogReadService instead of touching products/variants
 * directly, so property-inheritance precedence lives in one place.
 */
@Module({
  imports: [CatalogAttributeModule],
  providers: [CatalogReadService],
  exports: [CatalogReadService],
})
export class CatalogReadModule {}
