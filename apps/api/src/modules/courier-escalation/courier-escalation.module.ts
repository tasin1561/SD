import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { EmailModule } from '../email/email.module';
import { AdminCourierEscalationController } from './controllers/admin-courier-escalation.controller';
import { InboundEmailController } from './controllers/inbound-email.controller';
import { InboundEmailGuard } from './guards/inbound-email.guard';
import { CourierOutboxQueue } from './queue/courier-outbox.queue';
import { CourierChannelSettingsService } from './services/courier-channel-settings.service';
import { CourierEscalationIngestService } from './services/courier-escalation-ingest.service';
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
 * A LEAF module: nothing imports it, it exports nothing.
 */
@Module({
  imports: [
    CourierSharedModule, // the MCP reader (R3: dependency-free, shared)
    CourierDelhiveryModule, // the support adapter + its capability flags
    EmailModule, // the 2FA code for a write-mode change
    AuthCommonModule, // audit
  ],
  controllers: [InboundEmailController, AdminCourierEscalationController],
  providers: [
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
  ],
})
export class CourierEscalationModule {}
