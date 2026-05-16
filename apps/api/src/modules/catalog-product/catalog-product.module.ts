import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerProductController } from './seller-product.controller';
import { CatalogProductService } from './services/catalog-product.service';

@Module({
  controllers: [SellerProductController],
  providers: [CatalogProductService, SellerJwtGuard],
  exports: [CatalogProductService],
})
export class CatalogProductModule {}
