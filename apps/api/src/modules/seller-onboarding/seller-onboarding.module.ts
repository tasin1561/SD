import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { SellerOnboardingService } from './services/seller-onboarding.service';

@Module({
  imports: [EmailModule],
  providers: [SellerOnboardingService],
  exports: [SellerOnboardingService],
})
export class SellerOnboardingModule {}
