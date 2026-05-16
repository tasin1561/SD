import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { EmailModule } from '../email/email.module';
import { CatalogCategoryModule } from '../catalog-category/catalog-category.module';
import { CatalogAttributeModule } from '../catalog-attribute/catalog-attribute.module';
import { SellerCategoryProposalController } from './seller-category-proposal.controller';
import { AdminCategoryProposalController } from './admin-category-proposal.controller';
import { SellerCategoryProposalService } from './services/seller-category-proposal.service';
import { AdminCategoryProposalService } from './services/admin-category-proposal.service';

@Module({
  imports: [EmailModule, CatalogCategoryModule, CatalogAttributeModule],
  controllers: [SellerCategoryProposalController, AdminCategoryProposalController],
  providers: [
    SellerCategoryProposalService,
    AdminCategoryProposalService,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
  exports: [SellerCategoryProposalService, AdminCategoryProposalService],
})
export class CatalogCategoryProposalModule {}
