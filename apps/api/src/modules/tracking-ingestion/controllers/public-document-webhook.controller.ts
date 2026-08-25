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
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { CourierDocumentIngestService } from '../services/courier-document-ingest.service';
import { WebhookAuthService } from '../services/webhook-auth.service';

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
@ApiTags('public-tracking')
@Public()
@ThrottleKey('ip')
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

    const headers: Prisma.InputJsonValue = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]),
    );

    // The raw payload lands in the SAME ledger as scans. A document that
    // fails to store can then be replayed from what actually arrived,
    // rather than being reconstructed from a log line.
    const body = isRecord(parsedBody) ? parsedBody : {};
    const webhook = await this.prisma.client.courierWebhook.create({
      data: {
        courierCode,
        httpMethod: req.method,
        endpoint: req.originalUrl,
        headers,
        rawBody,
        parsedBody: isRecord(parsedBody) ? (parsedBody as Prisma.InputJsonValue) : Prisma.JsonNull,
        signature: signature ?? null,
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
