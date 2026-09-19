import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EmailModule } from '../email/email.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AdminNotificationController } from './controllers/admin-notification.controller';
import { AdminNotificationBroadcastController } from './controllers/admin-notification-broadcast.controller';
import { SellerNotificationController } from './controllers/seller-notification.controller';
import { StoreNotificationController } from './controllers/store-notification.controller';
import { StoreNotificationPreferenceController } from './controllers/store-notification-preference.controller';
import { NotificationAudienceService } from './services/notification-audience.service';
import { NotificationBroadcastService } from './services/notification-broadcast.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationTopicCatalogService } from './services/notification-topic-catalog.service';
import { NotificationFeedService } from './services/notification-feed.service';
import { NotificationPolicyService } from './services/notification-policy.service';
import { NotificationSubscriptionService } from './services/notification-subscription.service';
import { StoreNotificationPreferenceService } from './services/store-notification-preference.service';
import { StoreNotificationSender } from './services/store-notification-sender.service';

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
  imports: [
    AuthCommonModule,
    EmailModule,
    // The R3 store-then-send primitive (NOTIF-2). Imported so ONE
    // dispatch call can carry both legs of a store notification — the
    // templated email through the ledger and the inbox row here — with
    // the audience, the store's own say and each person's mute resolved
    // once rather than twice. No cycle: the ledger module depends on
    // EmailModule alone.
    NotificationLedgerModule,
  ],
  controllers: [
    SellerNotificationController,
    AdminNotificationController,
    AdminNotificationBroadcastController,
    // RS-2's third identity gets the same inbox (2026-09-19). Two
    // controllers, because the guard short-circuits its permission gate
    // on a class-level self-service marker.
    StoreNotificationController,
    StoreNotificationPreferenceController,
  ],
  providers: [
    NotificationTopicCatalogService,
    NotificationAudienceService,
    NotificationPolicyService,
    NotificationDispatchService,
    NotificationFeedService,
    NotificationSubscriptionService,
    NotificationBroadcastService,
    StoreNotificationPreferenceService,
    StoreNotificationSender,
    SellerJwtGuard,
    StaffJwtGuard,
    StoreJwtGuard,
  ],
  exports: [
    NotificationTopicCatalogService,
    NotificationAudienceService,
    NotificationDispatchService,
    NotificationPolicyService,
    // The ONE place a message to a reseller store becomes two legs.
    StoreNotificationSender,
  ],
})
export class NotificationAudienceModule {}
