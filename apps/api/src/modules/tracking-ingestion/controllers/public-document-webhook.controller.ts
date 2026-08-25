import { createHash } from 'node:crypto';
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
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CourierDocumentType, Prisma, WebhookStatus } from '@skydrop/db';
import type { Request } from 'express';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Public } from '../../../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { minutes } from '../../../common/throttler/throttler.module';
import { CourierDocumentIngestService } from '../services/courier-document-ingest.service';
import { WebhookAuthService } from '../services/webhook-auth.service';

const SIGNATURE_HEADER = 'x-skydrop-signature';

interface DocumentAck {
  readonly received: true;
  readonly awbNumber: string | null;
  readonly stored: boolean;
}

/**
 * Documents a courier pushes: proof of delivery, sorter weight images,
 * reverse-pickup QC photos.
 *
 * SEPARATE ENDPOINTS, one per document, because Delhivery requires it —
 * their scan push and each document push are provisioned individually
 * and "cannot be combined into a single webhook endpoint". One route
 * with a type in the body would be refused at their end.
 *
 * Authentication is the SAME as the scan webhook (TRK-1): verify first,
 * store second. An unauthenticated payload is never written — the raw
 * ledger is reserved for payloads we know came from the courier, and a
 * table anyone on the internet can append to is not evidence.
 *
 * Unlike the scan webhook there is no queue behind this. Storing an
 * image is one upload; deferring it would mean holding megabytes of
 * base64 in a job payload to save nothing. The response still returns
 * inside their 500ms budget because a failed upload does not block it —
 * the row records the failure and the raw payload is already kept.
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

@ApiTags('public-tracking')
@Public()
@ThrottleKey('ip')
@Throttle({ default: { limit: WEBHOOK_RATE_LIMIT_PER_MIN, ttl: minutes(1) } })
@Controller('public/tracking/documents')
export class PublicDocumentWebhookController {
  constructor(
    private readonly auth: WebhookAuthService,
    private readonly documents: CourierDocumentIngestService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('epod/:courierCode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Proof of delivery push' })
  epod(
    @Param('courierCode') courierCode: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-skydrop-signature') signature?: string,
  ): Promise<DocumentAck> {
    return this.handle(CourierDocumentType.EPOD, courierCode, req, body, signature);
  }

  @Post('sorter-image/:courierCode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sorter weight/dimension image push' })
  sorter(
    @Param('courierCode') courierCode: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-skydrop-signature') signature?: string,
  ): Promise<DocumentAck> {
    return this.handle(CourierDocumentType.SORTER_IMAGE, courierCode, req, body, signature);
  }

  @Post('qc-image/:courierCode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reverse-pickup QC image push' })
  qc(
    @Param('courierCode') courierCode: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-skydrop-signature') signature?: string,
  ): Promise<DocumentAck> {
    return this.handle(CourierDocumentType.QC_IMAGE, courierCode, req, body, signature);
  }

  private async handle(
    docType: CourierDocumentType,
    courierCodeRaw: string,
    req: RawBodyRequest<Request>,
    parsedBody: unknown,
    signature?: string,
  ): Promise<DocumentAck> {
    const courierCode = courierCodeRaw.toLowerCase();
    const rawBody = req.rawBody?.toString('utf8') ?? '';

    // Verify BEFORE storing. Same discipline as TRK-1.
    const auth = await this.auth.verify({
      courierCode,
      rawBody,
      signatureHeader: signature,
    });
    if (!auth.valid) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_UNAUTHENTICATED',
        message: 'Signature missing or invalid',
      });
    }

    // The auth header is REDACTED out of the stored copy. Under
    // SHARED_SECRET its value IS the credential, so keeping it would
    // write the secret into the database on every push — the exact thing
    // CUR-1 exists to prevent (key in env, never in a row).
    const headers: Prisma.InputJsonValue = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        k.toLowerCase() === SIGNATURE_HEADER
          ? '[redacted]'
          : Array.isArray(v)
            ? v.join(',')
            : (v ?? ''),
      ]),
    );

    // The raw payload lands in the SAME ledger as scans. A document that
    // fails to store can then be replayed from what actually arrived,
    // rather than being reconstructed from a log line.
    const body = isRecord(parsedBody) ? parsedBody : {};

    // The image is stripped from BOTH stored copies of the payload.
    // Keeping it would put a multi-megabyte base64 string in Postgres
    // for every document — on a 10GB managed disk that is a few weeks of
    // runway — and the bytes are already in Spaces, which is what object
    // storage is for. What stays is everything needed to understand what
    // arrived: the AWB, the reference, and the size of what we dropped.
    const ledgerBody = redactImageFields(body);

    const webhook = await this.prisma.client.courierWebhook.create({
      data: {
        courierCode,
        httpMethod: req.method,
        endpoint: req.originalUrl,
        headers,
        rawBody: JSON.stringify(ledgerBody),
        parsedBody: ledgerBody as Prisma.InputJsonValue,
        // A hash of the RAW body, never the header — same reasoning as
        // the scan ingest: under SHARED_SECRET the header is a constant,
        // so storing it would both leak the secret and be useless as an
        // identity for the payload.
        signature: createHash('sha256').update(rawBody, 'utf8').digest('hex'),
        signatureValid: true,
        remoteIp: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        // PROCESSED immediately: unlike a scan there is no transition to
        // attempt afterwards, so leaving it RECEIVED would make every
        // document look like unfinished work to anyone reading the
        // ledger.
        status: WebhookStatus.PROCESSED,
        processedAt: new Date(),
      },
      select: { id: true },
    });

    const result = await this.documents.ingest({
      courierCode,
      docType,
      body,
      webhookId: webhook.id,
    });
    return { received: true, awbNumber: result.awbNumber, stored: result.stored };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every field any of the three pushes carries the image in. */
const IMAGE_FIELDS = new Set(['epod', 'image', 'weight_images', 'weightimages', 'qcimage']);

/** Replace image bytes with a note of how big they were. */
function redactImageFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] =
      IMAGE_FIELDS.has(k.toLowerCase()) && typeof v === 'string'
        ? `[image omitted — ${v.length} chars, stored in Spaces]`
        : v;
  }
  return out;
}
