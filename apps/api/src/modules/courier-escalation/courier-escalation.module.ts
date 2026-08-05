import { Module } from '@nestjs/common';
import { InboundEmailController } from './controllers/inbound-email.controller';
import { InboundEmailGuard } from './guards/inbound-email.guard';
import { CourierEscalationIngestService } from './services/courier-escalation-ingest.service';
import { CourierMcpReaderService } from './services/courier-mcp-reader.service';
import { CourierMessageClassifierService } from './services/courier-message-classifier.service';
import { InboundEmailAuthService } from './services/inbound-email-auth.service';

/**
 * Phase 2 — the read pipeline.
 *
 * Courier replies reach the Skydrop thread without a human relaying
 * them. Three channels, deliberately redundant because each fails
 * differently:
 *
 *   - **EMAIL** — the one that works today. Cloudflare Email Routing →
 *     Worker → this module's webhook.
 *   - **MCP** — built and inert; blocked on Delhivery provisioning a
 *     realm. Reports itself unavailable rather than throwing.
 *   - **PORTAL** — Phase 5, and gated behind its own approval.
 *
 * An escalation HANGS OFF a Ticket (R7). There is no second seller-facing
 * entity: ops works one queue.
 *
 * A LEAF module — nothing imports it, it exports nothing. The only entry
 * point is the public HMAC-authenticated webhook.
 */
@Module({
  controllers: [InboundEmailController],
  providers: [
    InboundEmailAuthService,
    InboundEmailGuard,
    CourierMessageClassifierService,
    CourierEscalationIngestService,
    CourierMcpReaderService,
  ],
})
export class CourierEscalationModule {}
