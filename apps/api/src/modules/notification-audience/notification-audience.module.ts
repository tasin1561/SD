import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EmailModule } from '../email/email.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminNotificationController } from './controllers/admin-notification.controller';
import { AdminNotificationBroadcastController } from './controllers/admin-notification-broadcast.controller';
import { SellerNotificationController } from './controllers/seller-notification.controller';
import { NotificationAudienceService } from './services/notification-audience.service';
import { NotificationBroadcastService } from './services/notification-broadcast.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationTopicCatalogService } from './services/notification-topic-catalog.service';
import { NotificationFeedService } from './services/notification-feed.service';
import { NotificationPolicyService } from './services/notification-policy.service';
import { NotificationSubscriptionService } from './services/notification-subscription.service';

/**
 * Notifications that can address an AUDIENCE, on more than one channel.
 *
 * The M11 lifecycle fan-out remains where it is — this does not replace
 * it. What this adds is the missing addressing layer: a way to say
 * "everyone at this seller who handles stock" or "every staff member
 * who can pack" instead of one hardcoded email, and to reach them
 * in-app as well as by mail.
 *
 * Exports the dispatcher and the audience resolver so other domains can
 * send to a role without knowing how any of it works. The policy
 * service goes with them because refusing a channel is not something a
 * caller should be able to skip by not asking.
 */
@Module({
  imports: [AuthCommonModule, EmailModule],
  controllers: [
    SellerNotificationController,
    AdminNotificationController,
    AdminNotificationBroadcastController,
  ],
  providers: [
    NotificationTopicCatalogService,
    NotificationAudienceService,
    NotificationPolicyService,
    NotificationDispatchService,
    NotificationFeedService,
    NotificationSubscriptionService,
    NotificationBroadcastService,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
  exports: [
    NotificationTopicCatalogService,
    NotificationAudienceService,
    NotificationDispatchService,
    NotificationPolicyService,
  ],
})
export class NotificationAudienceModule {}
