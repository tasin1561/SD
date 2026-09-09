import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Prisma } from '@skydrop/db';
import { Throttle } from '@nestjs/throttler';
import { redactAuthHeaders } from '../services/webhook-headers';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { minutes } from '../../../common/throttler/throttler.module';
import { WebhookIngestService, type IngestOutcome } from '../services/webhook-ingest.service';

interface AckResponse {
  /** Stable identifier of the stored courier_webhooks row — useful for
   *  ops to correlate the courier's retry vs our processing. NOT
   *  considered secret (Phase 1A: opaque uuidv7). */
  webhookId: string;
  /** "stored" or "duplicate" (TRK-2 idempotent no-op). */
  result: 'stored' | 'duplicate';
}

/**
 * Module 10 — public courier webhook receiver (TRK-1/2). OPEN endpoint:
 * authentication IS the HMAC signature check (WebhookAuthService); a
 * failure 401s and the payload is NEVER stored. The handler:
 *
 *   1. Reads the raw request bytes (NestFactory rawBody:true; HMAC
 *      must be over the exact bytes signed).
 *   2. Delegates to WebhookIngestService — courier-code validation,
 *      HMAC verify, TRK-2 dedup, insert, enqueue.
 *   3. Returns 200 + the webhookId/result fast (target <500ms;
 *      processing is async — the BullMQ worker lands M10 commit 8).
 *
 * Signature header — Phase 1A reads `X-Skydrop-Signature`; the real
 * The Delhivery header NAME is not something to discover — it is OURS
 * to choose, in the Webhook Requirement Document we send them. Whatever
 * is written there must match what is read here; the credential itself
 * lives in env (CUR-1).
 *
 * Rate limit — `ip` strategy (the courier IP is the stable bucket;
 * a misbehaving / probing source IP gets throttled without locking
 * out the courier's legitimate delivery IPs which arrive from many
 * machines).
 */
/**
 * Delhivery pushes every one of our scans from a handful of fixed source
 * IPs, so the per-IP bucket is not "one caller" — it is our entire
 * tracking throughput. At the 100/min baseline, a burst of pushes gets a
 * 429, and their own requirement document says a webhook we do not
 * answer means the scan is MISSED. A lost scan is silent: the parcel
 * simply stops updating and nothing anywhere records why.
 *
 * So the ceiling is raised to something a real day cannot reach while
 * still being a ceiling. It stays a bound rather than an exemption
 * because the route is public and an unauthenticated caller still costs
 * us two queries before the 401.
 */
const WEBHOOK_RATE_LIMIT_PER_MIN = 3000;

/**
 * A path segment that is NOT the courier's name.
 *
 * Shiprocket's own webhook form refuses a URL containing "shiprocket",
 * "kartrocket", "sr" or "kr" — so `/webhooks/shiprocket`, the obvious
 * URL, cannot be saved on their side at all. The alias is theirs to
 * accept and ours to resolve; `carrier-b` carries none of those strings
 * and says what it is (the second carrier) without borrowing their
 * brand.
 *
 * A MAP rather than a special case, so a third courier with its own
 * naming rule is a line here instead of a branch in the handler.
 * Unaliased codes pass straight through, which is every other courier.
 */
const WEBHOOK_PATH_ALIASES: Readonly<Record<string, string>> = {
  'carrier-b': 'shiprocket',
};

function resolveCourierAlias(segment: string): string {
  const lower = segment.toLowerCase();
  return WEBHOOK_PATH_ALIASES[lower] ?? lower;
}

@ApiTags('public-tracking-webhooks')
@ThrottleKey('ip')
@Throttle({ default: { limit: WEBHOOK_RATE_LIMIT_PER_MIN, ttl: minutes(1) } })
@Controller('public/tracking/webhooks')
export class PublicWebhookController {
  constructor(private readonly ingest: WebhookIngestService) {}

  @Post(':courierCode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'TRK-1/2 — courier tracking webhook receiver (HMAC-authenticated, store-then-process). 401 if unauthenticated; never stores an unauthenticated payload. Duplicate signature ⇒ 200 idempotent no-op.',
  })
  async receive(
    @Param('courierCode') courierCode: string,
    @Req() req: RawBodyRequest<Request>,
    // Body is also parsed by Nest's global ValidationPipe (JSON if
    // valid); we pass parsedBody to the ingester for observability but
    // the HMAC commits to the RAW bytes only.
    @Body() parsedBody: unknown,
    @Headers('x-skydrop-signature') skydropSignature?: string,
    /*
      SHIPROCKET SENDS `x-api-key`, and we do not get to choose.

      Their webhook form has an "Auth Token Type" dropdown whose value is
      the HEADER NAME; there is no HMAC and no signing — the token is a
      static credential in a header, which is the SHARED_SECRET scheme
      WebhookAuthService already supports.

      Read as a fallback rather than a replacement: Delhivery's requirement
      document names `x-skydrop-signature`, and a courier that starts
      sending the wrong header should still fail closed rather than be
      quietly accommodated.
    */
    @Headers('x-api-key') apiKeyHeader?: string,
  ): Promise<AckResponse> {
    const signatureHeader = skydropSignature ?? apiKeyHeader;
    // Raw bytes (set by NestFactory rawBody:true). Fall back to an
    // empty string if missing — WebhookAuthService will then
    // fail-closed on SIGNATURE_MISMATCH (the empty body's HMAC won't
    // equal the supplied header).
    const rawBody = req.rawBody?.toString('utf8') ?? '';

    // The auth header is REDACTED — under SHARED_SECRET its value IS the
    // credential, so storing it verbatim wrote the secret into a row on
    // every push (CUR-1).
    const headersJson: Prisma.InputJsonValue = redactAuthHeaders(req.headers);

    const parsedBodyJson: Prisma.InputJsonValue | null = isJsonValue(parsedBody)
      ? (parsedBody as Prisma.InputJsonValue)
      : null;

    const outcome: IngestOutcome = await this.ingest.ingest({
      courierCode: resolveCourierAlias(courierCode),
      rawBody,
      parsedBody: parsedBodyJson,
      signatureHeader,
      httpMethod: req.method,
      endpoint: req.originalUrl,
      headers: headersJson,
      remoteIp: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return {
      webhookId: outcome.webhookId,
      result: outcome.status === 'STORED' ? 'stored' : 'duplicate',
    };
  }
}

/** Loose runtime check the parsed body is a JSON-compatible value
 *  (object/array/scalar — NOT a Buffer/Map/etc). */
function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  return (
    t === 'string' || t === 'number' || t === 'boolean' || t === 'object' // arrays / plain objects (the parser only produces these)
  );
}
