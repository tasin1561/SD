import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerNotificationPreferenceController } from './seller-notification-preference.controller';
import { SellerNotificationPreferenceService } from './services/seller-notification-preference.service';
import { SellerNotificationPreferenceResolver } from './services/seller-notification-preference-resolver.service';

@Module({
  controllers: [SellerNotificationPreferenceController],
  providers: [
    SellerNotificationPreferenceService,
    SellerNotificationPreferenceResolver,
    SellerJwtGuard,
  ],
  // The RESOLVER is the cross-module surface — the one reader of these
  // rows on the send path. The CRUD service stays for the screen.
  exports: [SellerNotificationPreferenceService, SellerNotificationPreferenceResolver],
})
export class SellerNotificationPreferenceModule {}
