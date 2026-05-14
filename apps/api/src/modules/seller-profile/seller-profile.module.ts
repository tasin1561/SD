import { Module } from '@nestjs/common';
import { SellerAuthModule } from '../seller-auth/seller-auth.module';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { SellerProfileController } from './seller-profile.controller';
import { SellerProfileService } from './services/seller-profile.service';

@Module({
  imports: [SellerAuthModule, SellerOnboardingModule],
  controllers: [SellerProfileController],
  providers: [SellerProfileService],
  exports: [SellerProfileService],
})
export class SellerProfileModule {}
