import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { SellerAuthController } from './seller-auth.controller';
import { SellerAuthService } from './seller-auth.service';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { EmailModule } from '../email/email.module';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { SellerNotificationPreferenceModule } from '../seller-notification-preference/seller-notification-preference.module';

@Module({
  imports: [EmailModule, SellerOnboardingModule, SellerNotificationPreferenceModule, FxModule],
  controllers: [SellerAuthController],
  providers: [SellerAuthService, SellerJwtGuard],
  exports: [SellerJwtGuard, SellerAuthService],
})
export class SellerAuthModule {}
