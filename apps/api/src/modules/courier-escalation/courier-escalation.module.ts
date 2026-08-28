import { Module } from '@nestjs/common';
import { CourierShiprocketModule } from '../courier-shiprocket/courier-shiprocket.module';
import { DelhiverySupportAdapterService } from '../courier-delhivery/services/delhivery-support-adapter.service';
import { ShiprocketSupportAdapterService } from '../courier-shiprocket/services/shiprocket-support-adapter.service';
import { COURIER_SUPPORT_ADAPTERS } from '../courier-shared/services/courier-support-adapter';
import { CourierSupportRegistryService } from './services/courier-support-registry.service';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { EmailModule } from '../email/email.module';
import { AdminCourierEscalationController } from './controllers/admin-courier-escalation.controller';
import { SellerCourierEscalationController } from './controllers/seller-courier-escalation.controller';
import { InboundEmailController } from './controllers/inbound-email.controller';
import { InboundEmailGuard } from './guards/inbound-email.guard';
import { CourierOutboxQueue } from './queue/courier-outbox.queue';
import { CourierChannelSettingsService } from './services/courier-channel-settings.service';
import { CourierEscalationIngestService } from './services/courier-escalation-ingest.service';
import { CourierEscalationService } from './services/courier-escalation.service';
import { CourierTemplateReviewService } from './services/courier-template-review.service';
import { CourierMessageClassifierService } from './services/courier-message-classifier.service';
import { CourierModeChallengeService } from './services/courier-mode-challenge.service';
import { CourierOpsQueueService } from './services/courier-ops-queue.service';
import { CourierOutboxDispatcherService } from './services/courier-outbox-dispatcher.service';
import { CourierOutboxReconcilerService } from './services/courier-outbox-reconciler.service';
import { CourierOutboxService } from './services/courier-outbox.service';
import { InboundEmailAuthService } from './services/inbound-email-auth.service';

/**
 * Phases 2-4 of the courier-escalation work.
 *
 * **Phase 2 — the read pipeline.** Courier replies reach the Skydrop
 * thread without a human relaying them. EMAIL works today (Cloudflare
 * Email Routing -> Worker -> the HMAC-guarded webhook here); MCP is built
 * and inert behind the realm 404; PORTAL is Phase 5 and unbuilt.
 *
 * **Phase 3 — the outbox.** A durable row whose STATE decides what may
 * happen next, because posting a comment is not idempotent and a retried
 * timeout duplicates a message in a thread the customer reads. Routing
 * happens at CLAIM time so flipping the mode cannot leave a backlog
 * executing yesterday intent.
 *
 * **Phase 4 — the ops console.** The MANUAL consumer, and today the ONLY
 * one that can do anything: every write capability is false, so the
 * dispatcher claims nothing and every item reaches a human.
 *
 * An escalation HANGS OFF a Ticket (R7) — ops works one queue, not two.
 *
 * ── NO LONGER A LEAF ─────────────────────────────────────────────────
 * It was, through Phase 4. Phase 5's portal worker is a SECOND consumer
 * of the outbox — a different channel for the same messages — so the two
 * services it needs are exported: the channel settings (mode, pause,
 * portal mode) and the outbox itself (claim, confirm, fail).
 *
 * Deliberately those TWO and no more. The ops-queue service, the mode
 * challenge and the reconciler stay internal: they are the console's and
 * the API's business, and a portal worker that could raise a 2FA
 * challenge or serve a queue page would be a portal worker doing
 * somebody else's job.
 */
@Module({
  imports: [
    CourierShiprocketModule,
    CourierSharedModule, // the MCP reader (R3: dependency-free, shared)
    CourierDelhiveryModule, // the support adapter + its capability flags
    EmailModule, // the 2FA code for a write-mode change
    AuthCommonModule, // audit
  ],
  controllers: [
    InboundEmailController,
    AdminCourierEscalationController,
    SellerCourierEscalationController,
  ],
  providers: [
    {
      // Every courier support desk. Adding one means implementing
      // CourierSupportAdapter and appending it HERE — the outbox, the
      // routing, the reconciler and the console do not change.
      provide: COURIER_SUPPORT_ADAPTERS,
      inject: [DelhiverySupportAdapterService, ShiprocketSupportAdapterService],
      useFactory: (
        delhivery: DelhiverySupportAdapterService,
        shiprocket: ShiprocketSupportAdapterService,
      ) => [delhivery, shiprocket],
    },
    CourierSupportRegistryService,
    InboundEmailAuthService,
    InboundEmailGuard,
    CourierMessageClassifierService,
    CourierEscalationIngestService,
    CourierChannelSettingsService,
    CourierOutboxService,
    CourierOutboxDispatcherService,
    CourierOutboxReconcilerService,
    CourierOpsQueueService,
    CourierModeChallengeService,
    CourierOutboxQueue,
    CourierEscalationService,
    CourierTemplateReviewService,
  ],
  exports: [CourierChannelSettingsService, CourierOutboxService, CourierEscalationService],
})
export class CourierEscalationModule {}
