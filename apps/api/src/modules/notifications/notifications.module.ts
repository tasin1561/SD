import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { NotificationEventMappingService } from './services/notification-event-mapping.service';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { NotificationListener } from './services/notification-listener.service';
import { AuthCommonModule } from '../auth-common/auth-common.module';

/**
 * Module 11 — Notifications fan-out.
 *
 * Architecture (extend-not-replace, M11 pre-flight): builds on top of
 * the existing `EmailModule` (ResendService + EmailQueue + EmailWorker
 * + EmailDispatchService + TemplateRenderService + the seeded
 * notification_templates). M11 adds the lifecycle-event fan-out layer
 * — mapping (single-source NOTIF-4), ledger (composite-key NOTIF-2
 * gate + post-commit enqueue), listener (post-commit subscriber on
 * the R3 OrderLifecycleEventBus) — without duplicating the substrate.
 *
 * Service surface (commit 4 of 10 — listener + event-bus land in
 * commits 5 + 6 + 7):
 *   - NotificationEventMappingService  (NOTIF-4, pure logic)
 *   - NotificationLedgerService        (NOTIF-2/3/8 — composite-key
 *                                       gate + enqueue + SKIPPED)
 *
 * Nothing is exported externally yet — `NotificationListener` (commit
 * 6) is the only consumer; it subscribes to the event bus and calls
 * the local mapping + ledger services. Other modules MUST NOT import
 * this module's internals (NOTIF-5 — order module remains unaware).
 */
@Module({
  imports: [
    // The listener audits a fan-out it could not complete — a log
    // line is not something anyone finds six weeks later.
    AuthCommonModule,
    EmailModule,
    LifecycleEventsModule,
    // The R3 store-then-send primitive, shared with seller-onboarding.
    NotificationLedgerModule,
  ],
  providers: [NotificationEventMappingService, NotificationListener],
  exports: [],
})
export class NotificationsModule {}
