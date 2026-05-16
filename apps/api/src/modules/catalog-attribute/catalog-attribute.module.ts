import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogCategoryModule } from '../catalog-category/catalog-category.module';
import { AdminAttributeController } from './admin-attribute.controller';
import { SellerAttributeController } from './seller-attribute.controller';
import { AttributeDefinitionService } from './services/attribute-definition.service';
import { AttributeResolutionService } from './services/attribute-resolution.service';

@Module({
  imports: [CatalogCategoryModule],
  controllers: [AdminAttributeController, SellerAttributeController],
  providers: [
    AttributeDefinitionService,
    AttributeResolutionService,
    StaffJwtGuard,
    SellerJwtGuard,
  ],
  exports: [AttributeDefinitionService, AttributeResolutionService],
})
export class CatalogAttributeModule {}
