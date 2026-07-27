import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { WebhookStatus } from '@skydrop/db';
import type { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WebhookAuthService } from './webhook-auth.service';
import { TrackingWebhookQueue } from '../queue/tracking-webhook.queue';

export interface IngestWebhookInput {
  /** URL-segment courier code (e.g. "delhivery"). Validated against the
   *  Courier table — unknown codes 401 (we do not advertise our
   *  integration list). */
  courierCode: string;
  /** Raw request body string (exactly as received over the wire). The
   *  HMAC is computed over THIS — never the re-serialized JSON. */
  rawBody: string;
  /** Pre-parsed JSON if the body is JSON. Stored in parsed_body for
   *  observability; null when the body did not parse cleanly. */
  parsedBody: Prisma.InputJsonValue | null;
  /** Value of the signature header, or undefined if absent. */
  signatureHeader: string | undefined;
  /** Request metadata for the audit trail. */
  httpMethod: string;
  endpoint: string;
  headers: Prisma.InputJsonValue;
  remoteIp: string | undefined;
  userAgent: string | undefined;
}

export type IngestOutcome =
  | {
      /** New row inserted; processor enqueued. */
      status: 'STORED';
      webhookId: string;
    }
  | {
      /** TRK-2 duplicate (same courier + signature, body byte-identical).
       *  The original webhookId is returned; no new row, no re-enqueue. */
      status: 'DUPLICATE';
      webhookId: string;
    };

/**
 * Module 10 — public webhook ingest (TRK-1 + TRK-2). The controller's
 * authenticate-store-ack-enqueue worker:
 *
 *   1. Validate the courier code against the Courier registry (a
 *      typo / probe gets 401, NOT a 404 leak).
 *   2. Verify the HMAC signature (WebhookAuthService). Any failure →
 *      401, NO courier_webhooks row written (TRK-1 — the raw ledger
 *      is reserved for AUTHENTICATED payloads only).
 *   3. TRK-2 dedup: query courier_webhooks for an existing row with
 *      (courierCode, contentHash) — sha256 of the RAW BODY, stored in
 *      the `signature` column. Not the auth header: Delhivery sends a
 *      static credential, so header-keyed dedup would collapse every
 *      scan into the first one. Match ⇒ 200 no-op with the original
 *      webhookId.
 *   4. Insert the row (status=RECEIVED, signatureValid=true,
 *      receivedAt=now).
 *   5. Enqueue the BullMQ processing job (jobId=webhookId, dedup).
 *      Failure to enqueue is logged HIGH but does NOT fail the
 *      request — the stored row is the authoritative ledger and ops
 *      can manually re-enqueue (the queue dedups by jobId).
 *   6. Return webhookId — the controller responds 200 ack.
 *
 * Idempotency note (TRK-2): the dedup uses (courierCode, body hash)
 * because Phase 1A has no per-courier scan-event-id field surfaced in
 * the schema. A unique constraint would be airtight; a race window
 * exists between the check and the insert. Phase-1A volume makes
 * this acceptable. Future hardening: add a `(courier_code, signature)`
 * partial-unique index OR extract the scan_event_id from the parsed
 * payload (TODO(delhivery-api) — the field name is not reliably
 * known) and key dedup on that.
 */
@Injectable()
export class WebhookIngestService {
  private readonly logger = new Logger(WebhookIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: WebhookAuthService,
    private readonly queue: TrackingWebhookQueue,
  ) {}

  async ingest(input: IngestWebhookInput): Promise<IngestOutcome> {
    // (1) Validate courier code — unknown → 401 (don't leak the registry).
    const courier = await this.prisma.client.courier.findUnique({
      where: { code: input.courierCode },
      select: { code: true, deletedAt: true },
    });
    if (!courier || courier.deletedAt !== null) {
      // 401 + same wording as auth failure: an attacker probing the
      // surface gets no useful signal whether the courier is unknown
      // vs. their signature is wrong.
      this.logger.warn(
        { courierCode: input.courierCode },
        'Webhook for unknown courier — rejecting',
      );
      throw new UnauthorizedException({
        code: 'WEBHOOK_UNAUTHENTICATED',
        message: 'Webhook authentication failed',
      });
    }

    // (2) Authenticate (HMAC over raw body).
    const authResult = await this.auth.verify({
      courierCode: input.courierCode,
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
    });
    if (!authResult.valid) {
      // Coarse reason logged for ops; never the secret material.
      this.logger.warn(
        { courierCode: input.courierCode, reason: authResult.reason },
        'Webhook signature rejected',
      );
      throw new UnauthorizedException({
        code: 'WEBHOOK_UNAUTHENTICATED',
        message: 'Webhook authentication failed',
      });
    }

    // (3) TRK-2 dedup — keyed on a hash of the BODY, not the auth header.
    //
    // This used to store the signature header and dedup on that, which
    // worked only because every courier was assumed to sign: an HMAC is
    // a function of the body, so equal signatures meant equal bytes.
    // Delhivery does NOT sign — it returns a STATIC credential we
    // nominated (D5). Keying on that header would make every Delhivery
    // webhook look identical to the first one, so the first scan would
    // store and every subsequent scan would be silently discarded as a
    // duplicate. One tracking update, ever, with no error anywhere.
    //
    // A content hash is correct under both schemes: it is exactly what
    // "byte-identical body" means, which is what TRK-2 was always
    // trying to express.
    const signature = createHash('sha256')
      .update(input.rawBody, 'utf8')
      .digest('hex');
    const existing = await this.prisma.client.courierWebhook.findFirst({
      where: { courierCode: input.courierCode, signature },
      select: { id: true },
      orderBy: { receivedAt: 'desc' },
    });
    if (existing) {
      this.logger.log(
        { courierCode: input.courierCode, webhookId: existing.id },
        'Duplicate webhook (byte-identical body already stored) — no-op',
      );
      return { status: 'DUPLICATE', webhookId: existing.id };
    }

    // (4) Insert the raw inbound row. status=RECEIVED, signatureValid=true.
    // Conditionally spread the optional fields so `exactOptionalProperty
    // Types: true` is honored — Prisma's create input does not accept
    // `undefined` for an optional column, only omitted-or-defined.
    const row = await this.prisma.client.courierWebhook.create({
      data: {
        courierCode: input.courierCode,
        httpMethod: input.httpMethod,
        endpoint: input.endpoint,
        headers: input.headers,
        rawBody: input.rawBody,
        ...(input.parsedBody !== null ? { parsedBody: input.parsedBody } : {}),
        signature,
        signatureValid: true,
        remoteIp: input.remoteIp ?? null,
        userAgent: input.userAgent ?? null,
        status: WebhookStatus.RECEIVED,
      },
      select: { id: true },
    });

    // (5) Enqueue for processing. Failure is logged + audited HIGH but
    //     does NOT fail the request — the stored row is the source of
    //     truth and ops can re-enqueue (queue jobId = webhookId).
    try {
      await this.queue.enqueueWebhook(row.id);
    } catch (err) {
      this.logger.error(
        {
          courierCode: input.courierCode,
          webhookId: row.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'Webhook stored but enqueue failed — ops re-enqueue required',
      );
    }

    return { status: 'STORED', webhookId: row.id };
  }
}
