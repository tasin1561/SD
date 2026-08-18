import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { EmailModule } from '../email/email.module';
import { SpacesModule } from '../../infrastructure/spaces/spaces.module';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { SellerProfileController } from './seller-profile.controller';
import { BankAccountCipherService } from './services/bank-account-cipher.service';
import { SellerLogoService } from './services/seller-logo.service';
import { SellerProfileService } from './services/seller-profile.service';

@Module({
  imports: [SellerOnboardingModule, SpacesModule, AuthCommonModule, EmailModule],
  controllers: [SellerProfileController],
  providers: [SellerProfileService, BankAccountCipherService, SellerLogoService, SellerJwtGuard],
  exports: [SellerProfileService, BankAccountCipherService],
})
export class SellerProfileModule {}
