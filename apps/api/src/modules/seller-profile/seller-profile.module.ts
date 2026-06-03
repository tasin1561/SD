import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { SellerProfileController } from './seller-profile.controller';
import { BankAccountCipherService } from './services/bank-account-cipher.service';
import { SellerProfileService } from './services/seller-profile.service';

@Module({
  imports: [SellerOnboardingModule],
  controllers: [SellerProfileController],
  providers: [SellerProfileService, BankAccountCipherService, SellerJwtGuard],
  exports: [SellerProfileService],
})
export class SellerProfileModule {}
