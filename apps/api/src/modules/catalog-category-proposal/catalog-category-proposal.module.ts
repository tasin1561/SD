import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { EmailModule } from '../email/email.module';
import { SellerCategoryProposalController } from './seller-category-proposal.controller';
import { SellerCategoryProposalService } from './services/seller-category-proposal.service';

@Module({
  imports: [EmailModule],
  controllers: [SellerCategoryProposalController],
  providers: [SellerCategoryProposalService, SellerJwtGuard],
  exports: [SellerCategoryProposalService],
})
export class CatalogCategoryProposalModule {}
