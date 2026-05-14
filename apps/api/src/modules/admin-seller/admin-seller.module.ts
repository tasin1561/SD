import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerManagementModule } from '../seller-management/seller-management.module';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { AdminSellerController } from './admin-seller.controller';
import { AdminSellerService } from './services/admin-seller.service';

@Module({
  imports: [SellerManagementModule, SellerOnboardingModule],
  controllers: [AdminSellerController],
  providers: [AdminSellerService, StaffJwtGuard],
})
export class AdminSellerModule {}
