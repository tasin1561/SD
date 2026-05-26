import { Module } from '@nestjs/common';
import { NotificationEventMappingService } from './services/notification-event-mapping.service';

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
 * Service surface (commit 3 of 10 — only the mapping service is
 * provided in this commit; ledger + listener land in commits 4 + 6):
 *   - NotificationEventMappingService  (NOTIF-4, pure logic)
 *
 * Nothing is exported externally yet — `NotificationListener` (commit
 * 6) is the only consumer; it subscribes to the event bus and calls
 * the local mapping + ledger services. Other modules MUST NOT import
 * this module's internals (NOTIF-5 — order module remains unaware).
 */
@Module({
  providers: [NotificationEventMappingService],
  exports: [],
})
export class NotificationsModule {}
