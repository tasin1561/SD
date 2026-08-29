import { Module } from '@nestjs/common';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { SellerOnboardingService } from './services/seller-onboarding.service';

@Module({
  imports: [NotificationLedgerModule],
  providers: [SellerOnboardingService],
  exports: [SellerOnboardingService],
})
export class SellerOnboardingModule {}
