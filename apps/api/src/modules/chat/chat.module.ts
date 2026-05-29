import { Module } from '@nestjs/common';
import { PublicChatWootWebhookController } from './controllers/public-chatwoot-webhook.controller';
import { ChatWootClientService } from './services/chatwoot-client.service';

/**
 * Module 18 — Live Chat (ChatWoot integration). **STUB SCAFFOLD
 * ONLY** in Phase 1A per the original CLAUDE.md scope:
 *
 *   "Live chat (ChatWoot self-hosted, separate droplet —
 *    deferred install)"
 *
 * Phase 1A ships:
 *   - ChatWootClientService stub (mirrors the M9 Delhivery STUB
 *     MODE pattern; real-mode wire seams flagged TODO(chatwoot-api)).
 *   - PublicChatWootWebhookController stub (accepts payloads, logs,
 *     returns 200; HMAC verification + ingestion deferred).
 *
 * Phase 1B (or droplet-install time) deliverables:
 *   - Real upstream API integration (upsert contact, create
 *     conversation, send message).
 *   - HMAC-verified webhook ingestion with a chat_webhooks dedup
 *     ledger (mirrors M10 TRK-1/TRK-2 if volume justifies).
 *   - Admin / seller UIs to surface conversation links on the
 *     order detail page.
 *   - Optional: notification fan-out wiring (NotificationListener
 *     emits a chat-channel side-effect when configured).
 */
@Module({
  controllers: [PublicChatWootWebhookController],
  providers: [ChatWootClientService],
  exports: [ChatWootClientService],
})
export class ChatModule {}
