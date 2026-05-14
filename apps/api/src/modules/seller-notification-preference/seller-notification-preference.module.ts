import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerNotificationPreferenceController } from './seller-notification-preference.controller';
import { SellerNotificationPreferenceService } from './services/seller-notification-preference.service';

@Module({
  controllers: [SellerNotificationPreferenceController],
  providers: [SellerNotificationPreferenceService, SellerJwtGuard],
  exports: [SellerNotificationPreferenceService],
})
export class SellerNotificationPreferenceModule {}
