import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { EnvService } from '../../../config/env.service';

/**
 * Public webhook receiver for ChatWoot events (message_created,
 * conversation_status_changed, etc.).
 *
 * STUB MODE (CHATWOOT_HMAC_SECRET empty): accepts payloads, logs
 * them, returns 200. Lets the integration boot without a configured
 * secret (matches the rest of M18).
 *
 * REAL MODE: requires the `X-Chatwoot-Hmac-Token` header to equal
 * HMAC-SHA256(rawBody, CHATWOOT_HMAC_SECRET) hex-encoded — ChatWoot's
 * documented webhook signing scheme. Mismatch → 401.
 *
 * Reads the RAW request body (not re-serialised JSON) because the
 * HMAC must verify byte-for-byte. The global `app.use(express.json({
 * verify }))` Nest setup is what captures `req.rawBody`; the API
 * bootstrap configured `rawBody: true` for the JSON parser long ago
 * (TRK-1 — the M10 webhook ingester uses the same mechanism).
 */
@ApiTags('public-chat-webhooks')
@Controller('public/chat/webhooks')
@ThrottleKey('ip')
export class PublicChatWootWebhookController {
  private readonly logger = new Logger(PublicChatWootWebhookController.name);

  constructor(private readonly env: EnvService) {}

  @Public()
  @Throttle({ default: { limit: 100, ttl: 60 * 1000 } })
  @Post('chatwoot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive ChatWoot webhook. HMAC-verified when CHATWOOT_HMAC_SECRET is set; otherwise accept + log.',
  })
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-chatwoot-hmac-token') signature: string | undefined,
  ): { ok: true; mode: 'STUB' | 'VERIFIED' } {
    const secret = this.env.chatwootHmacSecret;
    if (!secret) {
      this.logger.log({ event: 'chatwoot.webhook' }, 'received (stub — no HMAC secret)');
      return { ok: true, mode: 'STUB' };
    }

    if (!signature) {
      throw new UnauthorizedException({
        code: 'CHATWOOT_SIGNATURE_MISSING',
        message: 'Missing X-Chatwoot-Hmac-Token header',
      });
    }

    const raw = req.rawBody ?? Buffer.from('');
    if (raw.length === 0) {
      throw new HttpException(
        { code: 'CHATWOOT_RAW_BODY_MISSING', message: 'Empty raw body' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const supplied = signature.trim().toLowerCase();
    if (
      !/^[0-9a-f]+$/.test(supplied) ||
      supplied.length !== expected.length ||
      !timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(supplied, 'utf8'),
      )
    ) {
      throw new UnauthorizedException({
        code: 'CHATWOOT_SIGNATURE_MISMATCH',
        message: 'Invalid HMAC signature',
      });
    }

    this.logger.log({ event: 'chatwoot.webhook' }, 'received (HMAC verified)');
    return { ok: true, mode: 'VERIFIED' };
  }
}
