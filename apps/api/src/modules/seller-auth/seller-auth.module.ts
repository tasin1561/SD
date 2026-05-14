import { Module } from '@nestjs/common';
import { SellerAuthController } from './seller-auth.controller';
import { SellerAuthService } from './seller-auth.service';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { EmailModule } from '../email/email.module';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';

@Module({
  imports: [EmailModule, SellerOnboardingModule],
  controllers: [SellerAuthController],
  providers: [SellerAuthService, SellerJwtGuard],
  exports: [SellerJwtGuard],
})
export class SellerAuthModule {}
