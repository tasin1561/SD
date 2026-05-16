import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AdminCategoryController } from './admin-category.controller';
import { SellerCategoryController } from './seller-category.controller';
import { CategoryService } from './services/category.service';

@Module({
  controllers: [AdminCategoryController, SellerCategoryController],
  providers: [CategoryService, StaffJwtGuard, SellerJwtGuard],
  exports: [CategoryService],
})
export class CatalogCategoryModule {}
