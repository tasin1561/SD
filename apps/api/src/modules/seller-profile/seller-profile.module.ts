import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { SellerProfileController } from './seller-profile.controller';
import { SellerProfileService } from './services/seller-profile.service';

@Module({
  imports: [SellerOnboardingModule],
  controllers: [SellerProfileController],
  providers: [SellerProfileService, SellerJwtGuard],
  exports: [SellerProfileService],
})
export class SellerProfileModule {}
