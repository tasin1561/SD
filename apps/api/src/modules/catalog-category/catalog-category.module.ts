import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminCategoryController } from './admin-category.controller';
import { CategoryService } from './services/category.service';

@Module({
  controllers: [AdminCategoryController],
  providers: [CategoryService, StaffJwtGuard],
  exports: [CategoryService],
})
export class CatalogCategoryModule {}
