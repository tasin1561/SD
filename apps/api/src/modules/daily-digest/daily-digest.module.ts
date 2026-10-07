import { Module } from '@nestjs/common';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { SystemIssuesModule } from '../system-issues/system-issues.module';
import { DailyDigestWorker } from './queue/daily-digest.worker';
import { DailyDigestService } from './services/daily-digest.service';

/**
 * The once-a-day summary of yesterday: delivered, came back, not
 * delivered — for a seller's whole business and for each reseller store.
 *
 * It owns no notification machinery of its own. The audience, the
 * policy, each store's say and each person's mute are all
 * `NotificationDispatchService`'s, which is why a member of a seller's
 * team gets this without anything here knowing what a member is: the
 * audience is "whoever may see orders".
 */
@Module({
  imports: [NotificationAudienceModule, SystemIssuesModule],
  providers: [DailyDigestService, DailyDigestWorker],
  exports: [DailyDigestService],
})
export class DailyDigestModule {}
