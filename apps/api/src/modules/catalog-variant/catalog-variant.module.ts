import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerVariantSearchController } from './seller-variant-search.controller';
import { SellerVariantController } from './seller-variant.controller';
import { CatalogVariantService } from './services/catalog-variant.service';

@Module({
  controllers: [SellerVariantController, SellerVariantSearchController],
  providers: [CatalogVariantService, SellerJwtGuard],
  exports: [CatalogVariantService],
})
export class CatalogVariantModule {}
