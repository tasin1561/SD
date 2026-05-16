import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogAttributeModule } from '../catalog-attribute/catalog-attribute.module';
import { SellerVariantController } from './seller-variant.controller';
import { CatalogVariantService } from './services/catalog-variant.service';
import { VariantAttributeValidatorService } from './services/variant-attribute-validator.service';

@Module({
  imports: [CatalogAttributeModule],
  controllers: [SellerVariantController],
  providers: [CatalogVariantService, VariantAttributeValidatorService, SellerJwtGuard],
  exports: [CatalogVariantService],
})
export class CatalogVariantModule {}
