import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';

/**
 * Public webhook receiver for ChatWoot events (conversation_created,
 * message_created, etc.). **STUB ONLY** in Phase 1A — the endpoint
 * accepts payloads, logs them, and returns 200. Real-mode HMAC
 * verification + dispatch is deferred to the droplet-install
 * phase.
 *
 * Mirrors the M10 webhook-ingest shape: open endpoint, throttled by
 * IP; the future authoritative ChatWootIngestService will verify
 * signatures + persist to a future `chat_webhooks` table (TODO
 * Phase 1B if needed).
 */
@ApiTags('public-chat-webhooks')
@Controller('public/chat/webhooks')
@ThrottleKey('ip')
export class PublicChatWootWebhookController {
  private readonly logger = new Logger(PublicChatWootWebhookController.name);

  @Public()
  @Throttle({ default: { limit: 100, ttl: 60 * 1000 } })
  @Post('chatwoot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive ChatWoot webhook (STUB — logs and acks; HMAC verify is TODO)',
  })
  receive(@Body() body: unknown): { ok: true; mode: 'STUB' } {
    this.logger.log({ event: 'chatwoot.webhook', payload: body }, 'received');
    return { ok: true, mode: 'STUB' };
  }
}
